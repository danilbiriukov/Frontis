import { pluginReportSchema } from '@code-pushup/models';
import { register } from 'node:module';
import { inspect } from 'node:util';
import { CollectorRunError } from '../collectors/code-pushup.js';
import type { GuardedPluginModule, PluginOutcome, PluginRequest } from './plugin-guard.js';

async function execute(request: PluginRequest): Promise<PluginOutcome> {
  try {
    const adapter = await import(request.module) as GuardedPluginModule;
    const prepared = await adapter.prepare(request.options, request.outputDir);
    if ('code' in prepared) {
      return { problem: prepared, status: 'no-data' };
    }
    const { executePlugin } = await import('@code-pushup/core');
    const report = await executePlugin(prepared, {
      cache: { read: false, write: false },
      persist: { outputDir: request.outputDir },
    });
    const parsed = pluginReportSchema.safeParse(report);
    if (!parsed.success) {
      return {
        status: 'error',
        problem: {
          code: 'invalid-result',
          reason: 'Результат плагина не соответствует формату Code PushUp.',
          action: 'Проверьте версию и настройки плагина.',
        },
        diagnostic: inspect(parsed.error),
      };
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
    return { report: parsed.data };
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
    process.send?.(outcome, (error) => {
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
