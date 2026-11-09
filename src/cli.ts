#!/usr/bin/env node
import { run } from './core/index.js';
import { frontisVersion } from './core/package-info.js';

const HELP = `frontis: аудит фронтенд-проекта с результатами в JSON и HTML

Использование:
  frontis run [опции]  запустить проверки в текущей папке
  frontis --help       показать эту справку
  frontis --version    показать версию

Опции run:
  --open, -o           открыть HTML-отчёт в браузере после завершения`;

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
    console.log(frontisVersion());
    return 0;
  }
  if (command === 'run') {
    if (rest.some(isHelp)) {
      console.log(HELP);
      return 0;
    }
    let open: boolean | undefined;
    for (const arg of rest) {
      if (arg === '--open' || arg === '-o') {
        open = true;
      } else {
        return unknownArgument(arg);
      }
    }
    return run({ cwd: process.cwd(), open });
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
