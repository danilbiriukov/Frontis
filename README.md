<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/danilbiriukov/Frontis/main/assets/brand/readme-header-dark.svg">
    <img alt="Frontis" src="https://raw.githubusercontent.com/danilbiriukov/Frontis/main/assets/brand/readme-header-light.svg" width="100%">
  </picture>
</p>

Frontis проверяет фронтенд-проект через Code PushUp и сохраняет результаты и рекомендации в JSON и автономном HTML. В отчёте видно, что исправить первым и почему отдельные проверки могли остаться без данных.

## Быстрый старт

Нужны Node.js 22 или новее, npm и установленный Git. Установите Frontis в корне однопакетного проекта с npm:

```sh
npm install -D frontis
```

Опубликованная версия `0.0.3` сохраняет JSON. Чтобы получить HTML и новые команды до выпуска `0.1.0`, выполните `npm run pack:release` в репозитории Frontis и установите созданный архив из корня проверяемого проекта командой `npm install -D "путь к frontis-0.0.3.tgz"`.

Создайте в корне файл `frontis.config.mjs` с настройками по умолчанию:

```js
export default {};
```

Запустите проверку:

```sh
npx frontis run
```

Список команд установленной версии покажет `npx frontis --help`.

Во время проверки Frontis показывает состояние модулей в консоли. Сборка из `develop` сохраняет HTML в `.frontis/report.html`.

## Настройки

Frontis ищет в каталоге запуска один файл `frontis.config.ts`, `frontis.config.mjs` или `frontis.config.js`. Он передаёт настройки Code PushUp в памяти. Файл `code-pushup.config` не требуется.

```js
export default {
  outFile: 'audit/report.html',
  open: true,
  testCommand: 'npm run test:coverage',
  modules: {
    prettier: { enabled: false },
    coverage: { timeoutMs: 180_000 },
  },
  thresholds: {
    coverage: { warn: 65, target: 90 },
    buildSize: { maxMb: 5 },
  },
};
```

Укажите `testCommand`, если в проекте есть команда, которая пишет LCOV. Frontis запускает её только при отсутствии пригодного готового отчёта. Для итогов тестов можно дополнительно записать JSON Jest или Vitest. [Настройки и примеры команд](docs/coverage.md)

`npx frontis run --open` открывает отчёт после проверки, даже если `open` выключен в конфигурации. `npx frontis open` открывает сохранённый отчёт по настроенному `outFile`. По умолчанию браузер не запускается. Явные относительные пути считаются от папки конфига. [Конфигурация движка](docs/engine-config.md)

## Результаты

- При наличии валидных аудитов `.frontis/report.json` содержит факты Code PushUp, а `.frontis/result.json` содержит оценку и рекомендации. HTML показывает доступные данные и причины пропусков.
- Если валидных аудитов нет, Frontis сохраняет `.frontis/no-data.json` и по возможности диагностический HTML. Предыдущие `report.json` и `result.json` удаляются при начале новой проверки.
- Технические журналы инструментов сохраняются в `.frontis/logs/`. Причины пропусков доступны в `.frontis/no-data.json` и при частичном результате.

Код выхода `0` означает, что Frontis записал результат хотя бы с одним валидным аудитом, включая частичный результат. Код `2` означает, что пригодных аудитов нет или произошла ошибка аргументов, конфигурации или записи. Диагностический отчёт не открывается автоматически. [Формат результатов](docs/result-format.md)

С флагом `--fail-on plan` команда `frontis run` возвращает `1`, если есть показатель со статусом «Запланировать» или «Исправить». Флаг `--fail-on fix` возвращает `1` для статуса «Исправить». В обоих случаях отчёт сохраняется.

## Требования к проекту и данные

Обязательный сценарий поддерживает один пакет npm в корне. Yarn и pnpm распознаются по метаданным, но полный аудит с ними ещё не подтверждён. В каталоге без репозитория Git Frontis использует временные метаданные, а в отчёте сохраняет `commit: null`. При недоступном реестре проверки зависимостей могут вернуть «Нет данных», остальные проверки продолжаются. [Источники данных и подсказки по проверкам](docs/frontis-plugins.md)

Добавьте `.frontis/` и настроенный путь HTML в `.gitignore`. Frontis хранит отчёты локально и не отправляет телеметрию. `npm audit` передаёт сведения о зависимостях настроенному реестру, а проверка версии Node.js обращается к `nodejs.org`. Конфиг JS или TS, `testCommand` и установленные инструменты выполняют код с правами текущего пользователя. Запускайте аудит в проектах, которым доверяете.

## Разработка

```sh
npm ci
npm run build
npm link
```

После `npm link` команда `frontis` доступна локально. Для пересборки при изменениях запустите `npm run dev`.

Проверки проекта запускаются командами `npm run lint` и `npm test`. CI проверяет Node.js 22 и 26 на Linux, Windows и macOS. [Версии Code PushUp и порядок обновления](docs/frontis-plugins.md#обновление-code-pushup)

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
