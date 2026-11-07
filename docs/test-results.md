# Итоги Jest и Vitest

`createTestResultsCollector({ reportFile })` читает JSON-отчёт уже выполненного прогона тестов. Путь `reportFile` задаётся от корня проекта. Как Frontis запускает тесты и проверяет свежесть отчётов, описано в [проверке покрытия](coverage.md).

## Форматы и флаги

Поддерживается JSON-отчёт в формате Jest. Vitest выдаёт совместимый формат.

| Инструмент | Команда |
| --- | --- |
| Jest | `jest --json --outputFile=.frontis/test-results.json --testLocationInResults` |
| Vitest | `vitest run --reporter=default --reporter=json --outputFile.json=.frontis/test-results.json` |

Jest не создаёт папку для `--outputFile`, поэтому `.frontis` должна существовать до запуска. `--testLocationInResults` добавляет строку упавшего теста в Jest. Vitest записывает строку только при `includeTaskLocation: true` в настройках `test`. Без неё находка указывает только файл. Второй `--reporter=default` в Vitest сохраняет обычный вывод в консоли.

## Результат

`data` содержит `passed`, `failed`, `skipped` и `total`. В `skipped` входят пропущенные, `todo` и отключённые тесты. Для каждого упавшего теста в `failedTests` сохраняются полное имя, файл от корня проекта, строка, если она есть, и первая строка сообщения об ошибке без цветовых кодов.

Файл тестов, который упал до запуска тестов (ошибка импорта или синтаксиса), попадает в `failedSuites`. В этом случае и при прерванном прогоне Jest (`wasInterrupted`) `complete` равен `false`. Упавшие тесты из остальных файлов при этом сохраняются.

Находки: `failed-test` для упавшего теста и `failed-test-suite` для файла, который не выполнился. Обе уровня `error`.

| `status` | `code` | Когда |
| --- | --- | --- |
| `ok` | | В отчёте есть хотя бы один тест или файл, который не выполнился |
| `no-data` | `no-test-report` | Файла отчёта нет |
| `error` | `invalid-test-report` | Некорректный JSON или не формат Jest/Vitest |
| `no-data` | `no-tests` | Отчёт корректный, но тестов в нём нет |
