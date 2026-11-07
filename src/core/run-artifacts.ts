import { mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Report } from '@code-pushup/models';
import type { FrontisResult } from './result.js';

export async function withCurrentRun<T>(outputDir: string, run: () => Promise<T>): Promise<T> {
  await mkdir(outputDir, { recursive: true });
  const lockFile = join(outputDir, 'run.lock');
  const lock = await open(lockFile, 'wx').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') {
      throw new Error('В каталоге .frontis уже идёт проверка. Дождитесь её завершения.', { cause: error });
    }
    throw error;
  });
  try {
    await lock.writeFile(`${process.pid}\n`);
    for (const file of ['report.json', 'result.json', 'no-data.json']) {
      await rm(join(outputDir, file), { force: true });
    }
    return await run();
  } finally {
    try {
      await lock.close();
    } finally {
      await rm(lockFile, { force: true });
    }
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
