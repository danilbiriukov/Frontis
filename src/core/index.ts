import { ConfigError, findConfigFile, loadConfigFile } from './config-file.js';

export interface RunOptions {
  cwd: string;
}

export async function run(options: RunOptions): Promise<number> {
  try {
    const configPath = findConfigFile(options.cwd);
    await loadConfigFile(configPath);
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