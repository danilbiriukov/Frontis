import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function writeReportFile(html: string, outFile: string): Promise<string> {
  const targetPath = resolve(process.cwd(), outFile);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, html, 'utf8');
  return targetPath;
}

export function openReportFile(filePath: string): Promise<void> {
  if (process.env.FRONTIS_TEST_SKIP_OPEN === '1') {
    return Promise.resolve();
  }
  const targetPath = resolve(process.cwd(), filePath);
  const targetUrl = pathToFileURL(targetPath).href;

  let cmd: string;
  let args: string[];

  if (process.platform === 'win32') {
    cmd = 'cmd.exe';
    args = ['/c', 'start', '""', targetUrl];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [targetUrl];
  } else {
    cmd = 'xdg-open';
    args = [targetUrl];
  }

  const { promise, resolve: res, reject: rej } = Promise.withResolvers<void>();

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', (error) => {
      rej(new Error(`Не удалось открыть отчёт в браузере: ${error.message}. Файл сохранён: ${targetPath}`, { cause: error }));
    });

    child.unref();
    setImmediate(() => res());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rej(new Error(`Не удалось открыть отчёт в браузере: ${message}. Файл сохранён: ${targetPath}`, { cause: error }));
  }

  return promise;
}
