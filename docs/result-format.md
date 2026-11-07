# Результаты запуска Frontis

При наличии хотя бы одного валидного аудита `frontis run` записывает в `.frontis/` два файла.

- `report.json` содержит факты Code PushUp и проходит проверку по схеме `Report` из `@code-pushup/models`. Группы и категории ссылаются на сохранившиеся аудиты и группы. Вне Git и в репозитории без коммитов поле `commit` равно `null`.
- `result.json` содержит оценку Frontis. Поля `runAt` и `durationMs` относятся к тому же запуску. `schemaVersion` задаёт версию формата, `tool` и `report` содержат версии Frontis и Code PushUp, `project` содержит имя, версию, ветку и SHA коммита при наличии.

При новом запуске Frontis очищает предыдущую пару файлов. Если валидных аудитов нет, остаётся `no-data.json` с причинами и команда возвращает код 2. Служебный `run.lock` содержит PID процесса и не даёт двум запускам одновременно записывать в один каталог. После аварийного завершения удалите этот файл, когда убедитесь, что процесс проверки завершён.

## Оценка

`indicators` содержит статусы показателей, ссылки `плагин/аудит`, находки и состояния отдельных проверок в `checks`. Если одна из проверок не дала данных, показатель отмечается как неполный. Подтверждённые находки влияют на статус и рекомендации. Для недоступной проверки сохраняются `code`, `reason` и `action`. В `now` и `target` записываются значения, отформатированные правилами Frontis.

`score` рассчитывается по статусам показателей. Если пригодных данных меньше чем по трём показателям, `value` и `zone` равны `null`. Метаданные проекта и отключённые желательные показатели в `total` не входят. Рекомендации перечисляются от высокой важности к низкой.

## Источники показателей

В `checks[].facts` остаются числа и версии, прочитанные из аудитов. `checks[].details.issues` содержит до десяти находок с исходным сообщением, важностью инструмента, ссылкой на аудит и местом в файле, если оно известно.

| Показатель | Аудиты Code PushUp | Используемые данные |
| --- | --- | --- |
| `outdated` | `js-packages/npm-outdated-prod`, `js-packages/npm-outdated-dev`, `js-packages/frontis-outdated-evidence` | Число пакетов, тип обновления и версии. Подтверждение метаданных и знаменатель для доли по каждой группе |
| `audit` | `js-packages/npm-audit-prod`, `js-packages/npm-audit-dev` | Число уязвимостей из `value`, уровень из сообщения, при его отсутствии используется `severity` |
| `unusedCode` | `frontis-knip` с аудитами `unused-files`, `unused-dependencies`, `unused-exports`, `unused-types`, `other-findings` | Числа из `value` и детали находок |
| `codeQuality` | Аудиты правил `eslint/*`, `eslint/frontis-checked-files`, `eslint/frontis-parse-errors` и аудиты `frontis-prettier/*` | Ошибки, предупреждения, проверенные файлы и частые правила ESLint. Число файлов, которым нужно форматирование, и ошибки разбора Prettier |
| `coverage` | `coverage/line-coverage`, `coverage/branch-coverage`, `coverage/function-coverage`, `coverage/frontis-lcov-date` и `frontis-tests/*` | Покрытие из `value`, дата LCOV из `displayValue`, разрывы до порога и цели. Итоги Jest и Vitest хранятся в проверке `tests` |
| `nodeVersion` | `frontis-node-version/project-version`, `frontis-node-version/latest-lts`, `frontis-node-version/version-lag` | Версии из `displayValue`, тип отставания из `value` |
| `buildSize` | `frontis-build-size/size-bytes`, `frontis-build-size/file-count`, `frontis-build-size/limit-bytes` | Размер, число файлов и предел из `value`, крупнейшие файлы из `details.table.rows` |

Отчёт ESLint без подтверждённого охвата и без находок получает причину `eslint-coverage-unconfirmed`. В текущих запусках Frontis сохраняет охват отдельно. [Проверки качества кода](code-quality.md)

При подтверждённых метаданных доли устаревших пакетов хранятся в `productionOutdatedPercent` и `developmentOutdatedPercent`. Устройство проверки описано в разделе об устаревших зависимостях. [Устаревшие зависимости](outdated-dependencies.md)

Парная фикстура показывает частичный запуск с рабочими аудитами knip, ESLint и покрытия, а также пропуском Prettier. [Входной report.json](../test/fixtures/result/report.json) · [Ожидаемый result.json](../test/fixtures/result/result.json)
