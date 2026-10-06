import { findConfigFile } from './config-file.js';

export interface RunOptions {
  cwd: string;
}

/** Точка входа ядра. Возвращает код выхода процесса. */
export async function run(options: RunOptions): Promise<number> {
  const configPath = findConfigFile(options.cwd);

  if (!configPath) {
    console.error(
      'Файл конфигурации не найден.\n' +
        'Создайте frontis.config.ts в корне проекта и запустите команду снова.',
    );
    return 2;
  }

  console.log(`Конфигурация: ${configPath}`);
  console.log('Запуск проверок пока не реализован.');
  return 0;
}