import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_NAMES = ['frontis.config.ts', 'frontis.config.mjs', 'frontis.config.js'];

/** Возвращает путь к первому найденному файлу конфигурации или undefined. */
export function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_NAMES) {
    const path = join(cwd, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}