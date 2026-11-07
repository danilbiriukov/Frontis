<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/danilbiriukov/Frontis/main/assets/brand/readme-header-dark.svg">
    <img alt="Frontis" src="https://raw.githubusercontent.com/danilbiriukov/Frontis/main/assets/brand/readme-header-light.svg" width="100%">
  </picture>
</p>

Консольная утилита для аудита фронтенд-проекта. Не проверяет код сама, а собирает результаты готовых инструментов (knip, eslint, jest или vitest, npm audit) и показывает их в одном локальном HTML-отчёте.

Цель: за один запуск понять состояние проекта и увидеть, что требует исправления.

Статус: ранняя разработка, версия 0.0.1.

## Разработка

Нужен Node.js 22 или новее.

    npm install
    npm run build
    npm link

После `npm link` команда `frontis` доступна в любой папке:

    frontis --help
    frontis run

Во время проверки `frontis run` показывает стадии модулей. В итоге отдельно указаны успешные проверки, ошибки и проверки без данных. Технические журналы инструментов хранятся в `.frontis/logs/`.

Команда возвращает код `0`, если записала результат хотя бы с одним валидным аудитом, даже когда часть проверок завершилась ошибкой. Если валидных аудитов нет, причины сохраняются в `.frontis/no-data.json`, а команда возвращает код `2`. Этот же код означает ошибку аргументов, конфигурации или записи.

Для пересборки при изменениях: `npm run dev`.

## Структура

- `src/core` ядро, запуск и [подготовка конфигурации движка](docs/engine-config.md)
- [Формат результатов](docs/result-format.md)
- `src/collectors` [контракт модулей сбора данных](docs/collector-contract.md)
- `src/plugins` [плагины Frontis для Code PushUp](docs/frontis-plugins.md)
- `src/report` сборка HTML-отчёта

## Публикация в npm

1. Обновите версию через `npm version <версия> --no-git-tag-version` и включите `package.json` и `package-lock.json` в PR. Для стабильного выпуска направьте PR в `main`, для предварительного выпуска с версией вида `0.1.0-beta.0` используйте ветку `release/*`.
2. После слияния создайте тег `v<версия>` на текущем коммите целевой ветки с новой версией и отправьте тег в GitHub.
3. Откройте **Actions → Release → Run workflow** и выберите целевую ветку. Workflow проверит тег, соберёт архив и опубликует его через npm Trusted Publishing. Стабильные выпуски получают метку `latest`, предварительные получают `next`.

## Лицензия

Apache 2.0
