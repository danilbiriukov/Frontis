import { resolveConfig } from './config.js';
import { findConfigFile, loadConfigFile } from './config-file.js';
import { ConfigError } from './errors.js';

export interface RunOptions {
  cwd: string;
}

export async function run(options: RunOptions): Promise<number> {
  try {
    const configPath = findConfigFile(options.cwd);
    resolveConfig(await loadConfigFile(configPath), configPath);
    console.log(`Конфигурация: ${configPath}`);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  console.log('Запуск проверок пока не реализован.');
  return 0;
}
