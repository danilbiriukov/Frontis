import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Report } from '@code-pushup/models';
import type { FrontisResult } from './result.js';

const activeRunMessage = 'В каталоге .frontis уже идёт проверка. Дождитесь её завершения.';

function isProcessActive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

export async function withCurrentRun<T>(outputDir: string, run: () => Promise<T>): Promise<T> {
  await mkdir(outputDir, { recursive: true });
  if (!(await lstat(outputDir)).isDirectory()) {
    throw new Error('Для .frontis нужен обычный каталог.');
  }
  const lockName = `run-${process.pid}.lock`;
  const lockFile = join(outputDir, lockName);
  await writeFile(lockFile, '', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') {
      throw new Error(activeRunMessage, { cause: error });
    }
    throw error;
  });
  try {
    // Сначала создаём свой файл, затем проверяем остальные. Два процесса не могут одновременно пропустить друг друга.
    const locks = await readdir(outputDir);
    for (const name of locks) {
      if (name === lockName) {
        continue;
      }
      if (name === 'run.lock') {
        const legacy = join(outputDir, name);
        const owner = await lstat(legacy)
          .then((entry) => entry.isFile() ? readFile(legacy, 'utf8') : '')
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
              return undefined;
            }
            throw error;
          });
        if (owner !== undefined && (owner.trim() === '' || isProcessActive(Number(owner)))) {
          throw new Error(activeRunMessage);
        }
      } else {
        const pid = /^run-(\d+)\.lock$/.exec(name)?.[1];
        if (pid !== undefined && isProcessActive(Number(pid))) {
          throw new Error(activeRunMessage);
        }
      }
    }
    for (const file of ['report.json', 'result.json', 'no-data.json']) {
      await rm(join(outputDir, file), { force: true });
    }
    return await run();
  } finally {
    await rm(lockFile, { force: true });
  }
}

export async function writeResultArtifacts(outputDir: string, report: Report, result: FrontisResult): Promise<void> {
  const staging = await mkdtemp(join(outputDir, 'result-'));
  const resultFile = join(outputDir, 'result.json');
  try {
    await writeFile(join(staging, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(staging, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    await rename(join(staging, 'result.json'), resultFile);
    try {
      await rename(join(staging, 'report.json'), join(outputDir, 'report.json'));
    } catch (error) {
      await rm(resultFile, { force: true });
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 2 });
  }
}
