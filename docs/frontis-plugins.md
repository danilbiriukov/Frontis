# Плагины Frontis для Code PushUp

`frontis run` проверяет код, зависимости npm, покрытие, версию Node.js и размер сборки. Каждый модуль можно отключить через `modules` в `frontis.config`. Frontis использует тайм-ауты из конфига, выводит число полученных аудитов и сохраняет причины пропуска в `.frontis/no-data.json`. Если аудитов нет, команда возвращает код 2. [Проверки качества кода](code-quality.md) · [Устаревшие зависимости](outdated-dependencies.md) · [Уязвимости зависимостей](dependency-audit.md) · [Покрытие и итоги тестов](coverage.md)

В каталоге без репозитория Frontis использует установленный Git для создания временных метаданных и удаляет их после прогона. В `report.json` сохраняется `commit: null`. [Файлы результата](result-format.md)

| Проверка | Откуда берутся данные и что проверить при пропуске |
| --- | --- |
| Метаданные проекта | Имя и версия из корневого `package.json`, менеджер пакетов из его поля `packageManager` или lock-файла, ветка и коммит из Git. [Метаданные проекта](project-info.md) |
| Устаревшие зависимости | Декларации npm и сведения настроенного реестра. Проверьте доступ к реестру и сведения о версиях. [Отставание зависимостей](outdated-dependencies.md) |
| Уязвимости | `npm audit` использует npm lock-файл и настроенный реестр. При пропуске проверьте наличие lock-файла, доступ к реестру и поддержку команды audit. [Проверка уязвимостей](dependency-audit.md) |
| Неиспользуемый код | Knip из проверяемого проекта. Установите его и проверьте настройки точек входа. [Настройки knip](knip.md) |
| Качество кода | ESLint использует конфиг проекта и доступные исходники. Prettier запускается отдельно из зависимостей проекта. Проверьте шаблоны файлов и установку инструментов. [ESLint и Prettier](code-quality.md) |
| Покрытие и тесты | `coverage/lcov.info` или `lcov.info`, JSON Jest или Vitest в `.frontis/test-results.json`. Создайте эти файлы заранее или настройте `testCommand`. [Покрытие и форматы](coverage.md) |
| Версия Node.js | `.nvmrc` или `engines.node` и список релизов с `nodejs.org`. Проверьте требование к версии и доступ к списку. [Версия Node.js](node-version.md) |
| Размер сборки | Файлы в `buildDir`. Соберите проект и проверьте путь к каталогу. [Размер сборки](build-size.md) |

Если в корне есть lock-файлы нескольких менеджеров, укажите используемый менеджер в поле `packageManager` манифеста проекта. Например, при `npm ci` задайте `"packageManager": "npm@11.12.1"` с фактической версией npm. Без этого поля Frontis проверяет lock-файлы в порядке pnpm, Yarn, npm. [Выбор менеджера пакетов](project-info.md)

## Использование с Code PushUp

В обычном `code-pushup.config` добавьте нужные фабрики в массив `plugins`. По умолчанию фабрики проверяют текущий каталог.

```js
import {
  createBuildSizePlugin,
  createKnipPlugin,
  createNodeVersionPlugin,
  createPrettierPlugin,
} from 'frontis';

export default {
  plugins: [
    createKnipPlugin(),
    createPrettierPlugin(),
    createNodeVersionPlugin(),
    createBuildSizePlugin(process.cwd(), { buildDir: 'dist', maxMb: 5 }),
  ],
};
```

| Плагин | Аудиты |
| --- | --- |
| `frontis-knip` | `unused-files`, `unused-dependencies`, `unused-exports`, `unused-types`, `other-findings` |
| `frontis-prettier` | `checked-files`, `unformatted-files`, `parse-errors` |
| `frontis-node-version` | `project-version`, `latest-lts`, `version-lag` |
| `frontis-build-size` | `size-bytes`, `file-count`, `limit-bytes` |

Версии Node.js передаются в `displayValue`. Значения `version-lag` от 0 до 3 соответствуют отсутствию отставания, patch, minor и major. Аудит `size-bytes` включает таблицу крупнейших файлов.

## Обновление Code PushUp

Frontis использует точную версию `0.126.4` для `@code-pushup/core`, `@code-pushup/models`, `@code-pushup/js-packages-plugin`, `@code-pushup/eslint-plugin` и `@code-pushup/coverage-plugin`.

1. Обновите согласованные версии в `package.json` и lock-файл. Сверьте совместимость на Node.js 22 и 26.
2. Соберите проект и проверьте контракт без доступа к реестру. Запустите `npm run build`, затем `node --test test/code-pushup-contract.test.js test/result.test.js test/frontis-plugins.test.js`.
3. Если изменились поля модели или аудитов, проверьте адаптеры, нормализацию и отчёт на контрольных проектах. Обновите образец контракта после сверки с реальным отчётом. Затем запустите `npm run lint`, `npm test` и проверку установленного npm-архива. [Базовый отчёт и команды проверки совместимости](code-pushup-compatibility/README.md)
