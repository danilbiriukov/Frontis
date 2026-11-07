import { readProjectGit } from '../collectors/project-info.js';
import { loadEngineConfig } from './engine-config.js';
import { ConfigError } from './errors.js';
import { frontisVersion } from './package-info.js';
import { runGuardedPlugins } from './plugin-guard.js';
import { createReport } from './report.js';
import { createResult } from './result.js';
import { withCurrentRun, writeResultArtifacts } from './run-artifacts.js';
import type { TEngineAdapters } from './types/engine-config.js';

const adapters = {
  knip: new URL('../plugins/knip.js', import.meta.url).href,
  lint: new URL('../plugins/eslint.js', import.meta.url).href,
  prettier: new URL('../plugins/prettier.js', import.meta.url).href,
  'node-version': new URL('../plugins/node-version.js', import.meta.url).href,
  'build-size': new URL('../plugins/build-size.js', import.meta.url).href,
} satisfies TEngineAdapters;

export interface RunOptions {
  cwd: string;
}

export async function run(options: RunOptions): Promise<number> {
  const runAt = new Date().toISOString();
  const start = performance.now();
  try {
    const plan = await loadEngineConfig(options.cwd, adapters);
    console.log(`Конфигурация: ${plan.configPath}`);
    return await withCurrentRun(plan.outputDir, async () => {
      const { projectDir, modules, thresholds } = plan.config;
      const projectInfo = plan.projectInfo.status === 'ok' ? plan.projectInfo.data : undefined;
      const git = projectInfo === undefined ? await readProjectGit({ projectDir }) : projectInfo.git;
      const preflight = plan.noData.filter(({ plugin }) => plugin !== 'project-info');
      const { reports, noData } = await runGuardedPlugins(projectDir, plan.plugins, preflight);
      const report = createReport({
        plugins: reports,
        commit: git?.commit ?? null,
        runAt,
        durationMs: Math.round(performance.now() - start),
      });
      const audits = report?.plugins.reduce((count, plugin) => count + plugin.audits.length, 0) ?? 0;
      console.log(`Аудиты Frontis: ${audits}. Модули без данных: ${noData.length}.`);
      if (report === undefined) {
        return 2;
      }
      const result = createResult(report, {
        project: { name: projectInfo?.name ?? null, version: projectInfo?.version ?? null, branch: git?.branch ?? null },
        toolVersion: frontisVersion(),
        modules,
        thresholds,
        noData,
      });
      await writeResultArtifacts(plan.outputDir, report, result);
      return 0;
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}
