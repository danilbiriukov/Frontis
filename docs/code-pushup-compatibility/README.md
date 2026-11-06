# Совместимость с Code PushUp 0.126.4

Результат задачи [#39](https://github.com/danilbiriukov/Frontis/issues/39). Проверка выполнена на Windows с Node.js 22.22.0, npm 11.12.1 и Git 2.53.0.windows.2. На этой связке `collect(options)` из `@code-pushup/core` запускает три официальных плагина без `code-pushup.config`. Полученный JSON проходит `reportSchema` из `@code-pushup/models`. Для проекта вне Git движку нужны отдельные метаданные Git.

| Пакеты | Проверенная версия |
| --- | --- |
| `@code-pushup/core`, `@code-pushup/models` | `0.126.4` |
| `@code-pushup/js-packages-plugin`, `@code-pushup/eslint-plugin`, `@code-pushup/coverage-plugin` | `0.126.4` |
| `eslint` в контрольном проекте | `9.39.5` |

## Воспроизведение

Из корня Frontis, с Node.js 22, Git и доступом к npm-реестру.

```sh
npm --prefix docs/code-pushup-compatibility install --no-package-lock --ignore-scripts --no-audit --no-fund --legacy-peer-deps --omit=optional
npm --prefix docs/code-pushup-compatibility run probe
```

Инструменты устанавливаются отдельно от Frontis. `--legacy-peer-deps` исключает автоматическую установку окружения Nx, которое сценарий не использует. ESLint задан явно в манифесте.

Сценарий создаёт временный проект с намеренно устаревшими пакетами, двумя нарушениями ESLint и готовым LCOV. Он проверяет отказ движка вне Git, повторяет сбор с отдельными метаданными и затем выполняет контрольный запуск в репозитории с коммитом. Путь к проекту виден в консоли. В его папке `.frontis` сохраняются `report-without-git.json` и `report-with-git.json`.

[Пример report.json](sample-report.json) получен во втором запуске. В нём только данные контрольного проекта. Число уязвимостей и доступные версии зависят от ответа реестра.

## Каталог без Git

В обычном репозитории `commit` содержит `hash`, `author`, `message` и `date`. Вне репозитория `getLatestCommit()` возвращает `null`, но сбор прерывается на `git rev-parse --show-toplevel`. Ядро запрашивает корень Git при нормализации результатов даже для аудитов без путей к файлам. Плагин покрытия отдельно запрашивает корень для дерева файлов. [Нормализация в core](https://github.com/code-pushup/cli/blob/v0.126.4/packages/core/src/lib/normalize.ts)

Проверенный вариант для будущего запуска Frontis состоит в том, чтобы дать процессу Code PushUp пустые метаданные Git через `GIT_DIR` внутри `.frontis` и указать корень проверяемого проекта через `GIT_WORK_TREE`. Этого хватает для расчёта относительных путей. Сценарий подтверждает, что Git по-прежнему не обнаруживает репозиторий в корне проекта после снятия этих переменных. Поле `commit` присутствует в JSON со значением `null`, как допускает схема. Для отчёта Frontis предлагается подпись «Коммит недоступен» и пустая ветка. Ожидаемое предупреждение Git о пустой истории можно сохранить в техническом журнале. [Схема Report](https://github.com/code-pushup/cli/blob/v0.126.4/packages/models/src/lib/report.ts)

## Данные аудитов

Аудиты адресуются парой `plugins[].slug` и `audits[].slug`. Для оценки Frontis пригодны `value` и находки из `details`. Поле `displayValue` содержит форматированную строку.

| Плагин | Идентификаторы | Поля и ограничения |
| --- | --- | --- |
| `js-packages` | `npm-audit-prod`, `npm-audit-dev` | `value` содержит число уязвимостей по итогам npm. Группа определяется суффиксом аудита. `details.issues[].severity` берётся из `auditLevelMapping`. Исходный уровень, имя пакета, диапазон версий и сведения об исправлении, когда они есть, записаны в `message`. Число сообщений может отличаться от `value`. |
| `js-packages` | `npm-outdated-prod`, `npm-outdated-dev` | `value` содержит число устаревших пакетов. Имя, текущая и последняя версии, а также тип обновления доступны в `details.issues[].message`. Отдельных полей версий и доли устаревших пакетов нет. Для доли нужен знаменатель из `package.json` по той же группе. |
| `eslint` | `no-unused-vars`, `no-console-9b874a94de5d65c6` в примере | Один аудит на правило и набор его параметров. Суффикс может меняться с параметрами. `value` содержит число нарушений, `details.issues[].severity` различает `error` и `warning`, `source.file` и `source.position` указывают место. В контрольном прогоне была одна ошибка и одно предупреждение. |
| `coverage` | `function-coverage`, `branch-coverage`, `line-coverage` | `value` содержит процент от 0 до 100, `details.trees` содержит дерево файлов с долями от 0 до 1 и строками пропусков, если они известны. В примере получено 100% функций, 50% ветвей и 66,7% строк. |

Для `auditLevelMapping` проверен запуск с `critical` и `high` → `error`, `moderate` → `warning`, `low` и `info` → `info`. В контрольных данных реестр вернул находки уровней `high` и `critical`, обе отображаются с `severity: "error"`.

Плагин ESLint вызывает `npx eslint` с конфигурацией проекта. При шаблоне `src/absent-*.js` в контрольном каталоге он вернул `value: 0` и `score: 1` для обоих аудитов. В JSON нет счётчика проверенных файлов, поэтому для задачи [#11](https://github.com/danilbiriukov/Frontis/issues/11) число файлов нужно проверять отдельно.

Плагин покрытия принимает LCOV, причём путь в `reports` должен содержать `lcov`. `coverage/coverage-final.json` отклоняется при проверке конфигурации. Плагин может запустить команду генерации LCOV, но число упавших и пропущенных тестов в его аудитах отсутствует. Состояние тестов нужно получить отдельно. [Плагин покрытия](https://github.com/code-pushup/cli/tree/v0.126.4/packages/plugin-coverage)

## Доступ к npm-реестру

`js-packages` запускает npm в каталоге проекта. Для `npm audit` нужен `package-lock.json` и реестр с рабочим API аудита. Для `npm outdated` нужны установленные зависимости и доступ к метаданным их версий. npm использует настройки реестра проекта и окружения. Аудит передаёт реестру сведения о зависимостях. Проверен публичный `https://registry.npmjs.org/`. [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/) · [npm outdated](https://docs.npmjs.com/cli/v11/commands/npm-outdated/)

При проверке с пустым кэшем и реестром `http://127.0.0.1:1/` команда аудита завершилась с кодом 1 и прервала запуск плагина. Отдельный запуск только `outdated` выдал по обеим группам `value: 0` и `score: 1`. При известном сбое реестра нулю в таком отчёте доверять нельзя. Оба сценария используют npm 11.12.1. [Плагин JS-пакетов](https://github.com/code-pushup/cli/tree/v0.126.4/packages/plugin-js-packages)
