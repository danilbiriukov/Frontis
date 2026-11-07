import { loadEngineConfig } from './engine-config.js';
import { ConfigError } from './errors.js';
import { runGuardedPlugins } from './plugin-guard.js';
import type { TEngineAdapters } from './types/engine-config.js';

const adapters = {
  knip: new URL('../plugins/knip.js', import.meta.url).href,
  prettier: new URL('../plugins/prettier.js', import.meta.url).href,
  'node-version': new URL('../plugins/node-version.js', import.meta.url).href,
  'build-size': new URL('../plugins/build-size.js', import.meta.url).href,
} satisfies TEngineAdapters;

export interface RunOptions {
  cwd: string;
}

export async function run(options: RunOptions): Promise<number> {
  try {
    const plan = await loadEngineConfig(options.cwd, adapters);
    console.log(`Конфигурация: ${plan.configPath}`);
    const preflight = plan.noData.filter(({ plugin }) => Object.hasOwn(adapters, plugin));
    const { reports, noData } = await runGuardedPlugins(plan.config.projectDir, plan.plugins, preflight);
    const audits = reports.reduce((count, report) => count + report.audits.length, 0);
    console.log(`Аудиты Frontis: ${audits}. Модули без данных: ${noData.length}.`);
    return audits > 0 ? 0 : 2;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}
