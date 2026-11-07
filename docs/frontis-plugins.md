# Плагины Frontis для Code PushUp

`frontis run` запускает knip, Prettier, проверку версии Node.js и проверку размера сборки. Каждый модуль можно отключить через `modules` в `frontis.config`. Frontis использует отдельный тайм-аут для каждого модуля, выводит число полученных аудитов и сохраняет причины пропуска в `.frontis/no-data.json`. Если аудитов нет, команда возвращает код 2.

Для knip и Prettier нужны инструменты, установленные в проверяемом проекте. При работе вне Git Frontis создаёт временные метаданные в рабочей папке плагинов и удаляет их после прогона. Команда использует установленный Git. Валидные аудиты сохраняются в [файлах результата](result-format.md). HTML подключается в [#10](https://github.com/danilbiriukov/Frontis/issues/10).

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
