<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/danilbiriukov/Frontis/main/assets/brand/readme-header-dark.svg">
    <img alt="Frontis" src="https://raw.githubusercontent.com/danilbiriukov/Frontis/main/assets/brand/readme-header-light.svg" width="100%">
  </picture>
</p>

Frontis запускает проверки фронтенд-проекта через Code PushUp и сохраняет результаты и рекомендации в JSON. Версия 0.0.3 включает проверку зависимостей npm, анализ ESLint, Prettier и knip, сбор покрытия и результатов Jest или Vitest, проверку версии Node.js и размера сборки.

## Быстрый старт

Нужны Node.js 22 или новее и Git. Установите Frontis в корне проверяемого проекта с npm:

```sh
npm install -D frontis
```

Создайте в корне файл `frontis.config.mjs` с настройками по умолчанию:

```js
export default {};
```

Запустите проверку:

```sh
npx frontis run
```

Во время проверки Frontis показывает состояние модулей в консоли. Доступность проверок зависит от конфигурации проекта и установленных инструментов. [Список проверок и требования к ним](docs/frontis-plugins.md)

## Результаты

- `.frontis/report.json` содержит аудиты Code PushUp.
- `.frontis/result.json` содержит статусы показателей, оценку и рекомендации Frontis.
- `.frontis/no-data.json` содержит причины, по которым отдельные проверки не дали результата. Технические журналы инструментов сохраняются в `.frontis/logs/`.

В ветке `develop` HTML-отчёт сохраняется в `.frontis/report.html`. Путь можно задать через `outFile`. Команда `frontis run --open` открывает отчёт после проверки, а `frontis open` открывает сохранённый отчёт. [Формат результатов](docs/result-format.md)

Код выхода `0` означает, что записан результат хотя бы с одним валидным аудитом. Код `2` означает, что валидных аудитов нет либо произошла ошибка аргументов, конфигурации или записи.

С флагом `--fail-on plan` команда `frontis run` возвращает `1`, если есть показатель со статусом «Запланировать» или «Исправить». Флаг `--fail-on fix` возвращает `1` только для статуса «Исправить». Отчёт в обоих случаях сохраняется.

## Разработка

```sh
npm ci
npm run build
npm link
```

После `npm link` команда `frontis` доступна локально. Для пересборки при изменениях запустите `npm run dev`.

## Структура

- `src/core` ядро, запуск и [подготовка конфигурации движка](docs/engine-config.md)
- [Формат результатов](docs/result-format.md)
- `src/collectors` [контракт модулей сбора данных](docs/collector-contract.md)
- `src/plugins` [плагины Frontis для Code PushUp](docs/frontis-plugins.md)

## Публикация в npm

1. Обновите версию через `npm version <версия> --no-git-tag-version` и включите `package.json` и `package-lock.json` в PR. Для стабильного выпуска направьте PR в `main`, для предварительного выпуска с версией вида `0.1.0-beta.0` используйте ветку `release/*`.
2. После слияния создайте тег `v<версия>` на текущем коммите целевой ветки с новой версией и отправьте тег в GitHub.
3. Откройте **Actions → Release → Run workflow** и выберите целевую ветку. Workflow проверит тег, соберёт архив и опубликует его через npm Trusted Publishing. Стабильные выпуски получают метку `latest`, предварительные получают `next`.

## Лицензия

Apache 2.0
