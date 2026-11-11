import { pluginReportSchema } from '@code-pushup/models';
import { lstat } from 'node:fs/promises';
import { register } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inspect } from 'node:util';
import { CollectorRunError } from '../collectors/code-pushup.js';
import {
  invalidPluginResult,
  PLUGIN_RESULT_MESSAGE,
  type GuardedPluginModule,
  type PluginOutcome,
  type PluginRequest,
} from './plugin-guard.js';

async function checkedOutputFile(outputFile: string, outputDir: string): Promise<string | undefined> {
  const file = resolve(outputFile);
  const directory = relative(outputDir, dirname(file));
  if (directory === '' || directory === '..' || directory.startsWith(`..${sep}`) || isAbsolute(directory)) {
    return;
  }
  if (!(await lstat(outputDir)).isDirectory()) {
    return;
  }
  let current = outputDir;
  for (const part of directory.split(sep)) {
    current = join(current, part);
    try {
      if (!(await lstat(current)).isDirectory()) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
  return file;
}

async function execute(request: PluginRequest): Promise<PluginOutcome> {
  try {
    const adapter = await import(request.module) as GuardedPluginModule;
    const prepared = await adapter.prepare(request.options, request.outputDir);
    if ('code' in prepared) {
      return { problem: prepared, status: 'no-data' };
    }
    const { runner } = prepared;
    let config = prepared;
    if (typeof runner === 'object') {
      // Code PushUp удаляет родительский каталог выходного файла после чтения.
      const outputFile = await checkedOutputFile(runner.outputFile, request.outputDir);
      if (outputFile === undefined) {
        return {
          status: 'error',
          problem: {
            code: 'unsafe-output-path',
            reason: 'Выходной файл плагина расположен за пределами разрешённой временной подпапки.',
            action: 'Укажите runner.outputFile в отдельной подпапке outputDir.',
          },
          diagnostic: `Недопустимый путь runner.outputFile: ${runner.outputFile}`,
        };
      }
      config = { ...prepared, runner: { ...runner, outputFile } };
    }
    const declaredAudits = prepared.audits.map(({ slug }) => slug);
    const { executePlugin } = await import('@code-pushup/core');
    const report = await executePlugin(config, {
      cache: { read: false, write: false },
      persist: { outputDir: request.outputDir },
    });
    const parsed = pluginReportSchema.safeParse(report);
    if (!parsed.success) {
      return invalidPluginResult(inspect(parsed.error));
    }
    if (parsed.data.isSkipped || parsed.data.audits.every(({ isSkipped }) => isSkipped)) {
      return {
        status: 'no-data',
        problem: {
          code: 'no-audits',
          reason: 'Плагин не вернул ни одного выполненного аудита.',
          action: 'Проверьте настройки и область проверки инструмента.',
        },
      };
    }
    const problem = await adapter.validate?.(parsed.data, request.options, request.outputDir);
    if (problem !== undefined) {
      return { problem, status: 'no-data' };
    }
    return { report: parsed.data, declaredAudits };
  } catch (error) {
    if (error instanceof CollectorRunError) {
      const { code, reason, action, status } = error.result;
      return { problem: { code, reason, action }, status, diagnostic: inspect(error) };
    }
    throw error;
  }
}

process.once('message', async (request: PluginRequest) => {
  try {
    if (request.temporaryGit) {
      register('./temporary-git-hook.js', import.meta.url);
    }
    const outcome = await execute(request);
    process.send?.({ type: PLUGIN_RESULT_MESSAGE, outcome }, (error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
      process.disconnect?.();
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    process.disconnect?.();
  }
});
