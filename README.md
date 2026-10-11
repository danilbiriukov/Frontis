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

Для пересборки при изменениях: `npm run dev`.

## Структура

- `src/core` ядро: запуск, чтение конфига
- `src/collectors` модули сбора данных
- `src/report` сборка HTML-отчёта

## Лицензия

Apache 2.0