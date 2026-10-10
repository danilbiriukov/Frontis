#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from './core/index.js';

const HELP = `frontis: аудит фронтенд-проекта в один HTML-отчёт

Использование:
  frontis run          запустить проверки в текущей папке
  frontis --help       показать эту справку
  frontis --version    показать версию`;

function readVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

const isHelp = (arg: string | undefined): boolean => arg === '-h' || arg === '--help';

function unknownArgument(arg: string): number {
  console.error(`Неизвестный аргумент: ${arg}\nСправка: frontis --help`);
  return 2;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || isHelp(command)) {
    console.log(HELP);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    console.log(readVersion());
    return 0;
  }
  if (command === 'run') {
    if (rest.some(isHelp)) {
      console.log(HELP);
      return 0;
    }
    // Флагов у run пока нет: любой аргумент — ошибка, а не молчаливый пропуск
    if (rest.length > 0) return unknownArgument(rest[0]);
    return run({ cwd: process.cwd() });
  }

  console.error(`Неизвестная команда: ${command}\nСписок команд: frontis --help`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Сбой frontis: ${message}`);
    if (process.env.FRONTIS_DEBUG && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 2;
  },
);