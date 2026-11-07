import { execFile } from 'node:child_process';
import { join } from 'node:path';

const MAX_OUTPUT = 16 * 1024 * 1024;

export function npmInProject(cwd: string, outputDir: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'npm_config_cache'));
  env.NPM_CONFIG_CACHE = join(outputDir, 'npm-cache');
  const windows = process.platform === 'win32';

  // В cmd передаются только фиксированные флаги и проверенные имена npm-пакетов.
  return (args: string[]): Promise<{ code: number; stdout: string }> => new Promise((resolve, reject) => {
    const command = windows ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
    const commandArgs = windows ? ['/d', '/s', '/c', 'npm', ...args] : args;
    execFile(command, commandArgs, { cwd, env, windowsHide: true, maxBuffer: MAX_OUTPUT }, (error, stdout) => {
      if (error === null || typeof error.code === 'number') {
        resolve({ code: error === null ? 0 : Number(error.code), stdout });
      } else {
        reject(new Error(`Не удалось запустить npm (${error.code ?? 'неизвестный код'}).`));
      }
    });
  });
}
