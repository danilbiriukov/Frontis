import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createJiti } from 'jiti';
import { ConfigError } from './errors.js';

export { ConfigError };

const CONFIG_NAMES = ['frontis.config.ts', 'frontis.config.mjs', 'frontis.config.js'];

export function findConfigFile(cwd: string): string {
  const found = CONFIG_NAMES.filter((name) => existsSync(join(cwd, name)));

  if (found.length === 0) {
    throw new ConfigError(
      'Файл конфигурации не найден.\n' +
        'Создайте frontis.config.ts в корне проекта и запустите команду снова.',
    );
  }
  if (found.length > 1) {
    throw new ConfigError(
      `Найдено несколько файлов конфигурации: ${found.join(', ')}.\n` +
        'Оставьте один и запустите команду снова.',
    );
  }
  return join(cwd, found[0]!);
}

export async function loadConfigFile(path: string): Promise<unknown> {
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
  try {
    return await jiti.import(path, { default: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Не удалось загрузить ${basename(path)}: ${message}`, { cause: error });
  }
}
