import { executePlugin } from '@code-pushup/core';
import { pluginReportSchema } from '@code-pushup/models';
import { inspect } from 'node:util';
import { CollectorRunError } from '../collectors/code-pushup.js';
import type { GuardedPluginModule, PluginOutcome, PluginRequest } from './plugin-guard.js';

async function execute(request: PluginRequest): Promise<PluginOutcome> {
  try {
    const adapter = await import(request.module) as GuardedPluginModule;
    const prepared = await adapter.prepare(request.options, request.outputDir);
    if ('code' in prepared) {
      return { problem: prepared };
    }
    const report = await executePlugin(prepared, {
      cache: { read: false, write: false },
      persist: { outputDir: request.outputDir },
    });
    const parsed = pluginReportSchema.safeParse(report);
    if (!parsed.success) {
      return {
        problem: {
          code: 'invalid-result',
          reason: 'Результат плагина не соответствует формату Code PushUp.',
          action: 'Проверьте версию и настройки плагина.',
        },
        diagnostic: inspect(parsed.error),
      };
    }
    const problem = await adapter.validate?.(parsed.data, request.options, request.outputDir);
    if (problem !== undefined) {
      return { problem };
    }
    return { report: parsed.data };
  } catch (error) {
    if (error instanceof CollectorRunError) {
      const { code, reason, action } = error.result;
      return { problem: { code, reason, action }, diagnostic: inspect(error) };
    }
    throw error;
  }
}

process.once('message', async (request: PluginRequest) => {
  try {
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
