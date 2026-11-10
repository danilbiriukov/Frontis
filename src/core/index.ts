import { readProjectGit } from '../collectors/project-info.js';
import { loadEngineConfig } from './engine-config.js';
import { ConfigError } from './errors.js';
import { frontisVersion } from './package-info.js';
import { createReport } from './report.js';
import { createResult } from './result.js';
import { withCurrentRun, writeResultArtifacts } from './run-artifacts.js';
import { runPlannedPlugins } from './run-plan.js';
import { createRunProgress } from './run-progress.js';
import type { TEngineAdapters } from './types/engine-config.js';
import { generateHtmlReport, openReportFile, writeReportFile } from '../report/index.js';

const adapters = {
  outdated: new URL('../plugins/js-packages.js', import.meta.url).href,
  audit: new URL('../plugins/npm-audit.js', import.meta.url).href,
  knip: new URL('../plugins/knip.js', import.meta.url).href,
  lint: new URL('../plugins/eslint.js', import.meta.url).href,
  prettier: new URL('../plugins/prettier.js', import.meta.url).href,
  coverage: new URL('../plugins/coverage.js', import.meta.url).href,
  'node-version': new URL('../plugins/node-version.js', import.meta.url).href,
  'build-size': new URL('../plugins/build-size.js', import.meta.url).href,
} satisfies TEngineAdapters;

export interface RunOptions {
  cwd: string;
  open?: boolean;
  failOn?: 'plan' | 'fix';
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
      const progress = createRunProgress();
      const { reports, noData } = await runPlannedPlugins(plan, progress.update);
      const report = createReport({
        plugins: reports,
        commit: git?.commit ?? null,
        runAt,
        durationMs: Math.round(performance.now() - start),
      });
      if (report === undefined) {
        progress.summary(0);
        const html = generateHtmlReport({
          noData,
          project: {
            name: projectInfo?.name ?? null,
            version: projectInfo?.version ?? null,
            branch: git?.branch ?? null,
            commit: git?.commit?.hash ?? null,
          },
        });
        try {
          const reportFile = await writeReportFile(html, plan.config.outFile);
          console.log(`Диагностический отчёт: ${reportFile}`);
        } catch (writeError) {
          const message = writeError instanceof Error ? writeError.message : String(writeError);
          console.error(`Ошибка записи отчёта: ${message}`);
        }
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
      const html = generateHtmlReport({ result, report, noData });
      let reportFile: string;
      try {
        reportFile = await writeReportFile(html, plan.config.outFile);
        console.log(`Отчёт: ${reportFile}`);
      } catch (writeError) {
        const message = writeError instanceof Error ? writeError.message : String(writeError);
        console.error(`Ошибка записи отчёта: ${message}`);
        return 2;
      }
      const audits = report.plugins.reduce((count, plugin) => count + plugin.audits.length, 0);
      progress.summary(audits);
      const shouldOpen = options.open ?? plan.config.open;
      if (shouldOpen) {
        try {
          await openReportFile(reportFile);
        } catch (openError) {
          const message = openError instanceof Error ? openError.message : String(openError);
          console.error(message);
        }
      }
      const { failOn } = options;
      if (failOn !== undefined && result.indicators.some(({ status }) => status === 'fix' || status === failOn)) {
        return 1;
      }
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
