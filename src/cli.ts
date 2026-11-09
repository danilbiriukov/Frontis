#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { findConfigFile, loadConfigFile } from './core/config-file.js';
import { resolveConfig } from './core/config.js';
import { run, type RunOptions } from './core/index.js';
import { frontisVersion } from './core/package-info.js';
import { openReportFile } from './report/index.js';

const HELP = `frontis: аудит фронтенд-проекта с результатами в JSON и HTML

Использование:
  frontis run [опции]  запустить проверки в текущей папке
  frontis open        открыть сохранённый HTML-отчёт
  frontis --help       показать эту справку
  frontis --version    показать версию

Опции run:
  --open, -o           открыть HTML-отчёт в браузере после завершения
  --fail-on plan|fix   вернуть код 1, если статус достиг указанного порога`;

const isHelp = (arg: string | undefined): boolean => arg === '-h' || arg === '--help';

function unknownArgument(arg: string): number {
  console.error(`Неизвестный аргумент: ${arg}\nСправка: frontis --help`);
  return 2;
}

async function openSavedReport(cwd: string): Promise<number> {
  const configPath = findConfigFile(cwd);
  const { outFile } = resolveConfig(await loadConfigFile(configPath), configPath);
  const report = await stat(outFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  });
  if (!report?.isFile()) {
    console.error(`Отчёт не найден: ${outFile}\nСоздайте его командой frontis run.`);
    return 2;
  }
  await openReportFile(outFile);
  console.log(`Отчёт: ${outFile}`);
  return 0;
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
  if (command === 'run' || command === 'open') {
    if (rest.some(isHelp)) {
      console.log(HELP);
      return 0;
    }
    if (command === 'open') {
      return rest[0] === undefined ? openSavedReport(process.cwd()) : unknownArgument(rest[0]);
    }
    const options: RunOptions = { cwd: process.cwd() };
    const args = rest.values();
    for (const arg of args) {
      if (arg === '--open' || arg === '-o') {
        options.open = true;
      } else if (arg === '--fail-on') {
        const threshold = args.next().value;
        if (threshold !== 'plan' && threshold !== 'fix') {
          console.error('Для --fail-on укажите plan или fix.');
          return 2;
        }
        options.failOn = threshold;
      } else {
        return unknownArgument(arg);
      }
    }
    return run(options);
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
