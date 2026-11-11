import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function writeReportFile(html: string, outFile: string): Promise<string> {
  const targetPath = resolve(process.cwd(), outFile);
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, '.frontis-html-'));
  try {
    const stagedFile = join(staging, 'report.html');
    await writeFile(stagedFile, html, 'utf8');
    await rename(stagedFile, targetPath);
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 2 });
  }
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
  let env: NodeJS.ProcessEnv | undefined;

  if (process.platform === 'win32') {
    cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:FRONTIS_REPORT_FILE -ErrorAction Stop'];
    env = { ...process.env, FRONTIS_REPORT_FILE: targetPath };
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [targetUrl];
  } else {
    cmd = 'xdg-open';
    args = [targetUrl];
  }

  return new Promise((complete, fail) => {
    const reject = (detail: string, cause?: unknown) => {
      fail(new Error(`Не удалось открыть отчёт в браузере: ${detail}. Файл сохранён: ${targetPath}`, { cause }));
    };
    const child = spawn(cmd, args, { env, stdio: 'ignore', timeout: 15_000, windowsHide: true });
    child.once('error', (error) => reject(error.message, error));
    child.once('close', (code, signal) => {
      if (code === 0) {
        complete();
      } else {
        reject(`системная команда завершилась: ${signal ?? code}`);
      }
    });
  });
}
