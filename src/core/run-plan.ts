import { randomUUID } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginReport } from '@code-pushup/models';
import {
  LCOV_FILES, TEST_RESULTS_FILE, UNCONFIRMED_TEST_COMMAND, fileStamp,
  type CoverageCommandState, type CoverageOptions, type TestCommandOptions,
} from '../plugins/coverage-contract.js';
import { JS_PACKAGES_PACKAGE, JS_PACKAGES_SLUG } from '../plugins/js-packages-contract.js';
import { runGuardedPlugins, type GuardedPlugin } from './plugin-guard.js';
import type { IEngineConfig } from './types/engine-config.js';
import type { TPluginProgress } from './types/run.js';

const testAdapter = new URL('../plugins/test-run.js', import.meta.url).href;
type LcovHistory = { pending: true } | { rejected: Record<string, string> };

async function readHistory(file: string): Promise<LcovHistory> {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as { rejected?: Record<string, string> } | null;
    return saved?.rejected && typeof saved.rejected === 'object' && !Array.isArray(saved.rejected)
      ? { rejected: saved.rejected }
      : { pending: true };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { rejected: {} } : { pending: true };
  }
}

async function lcovStamps(projectDir: string): Promise<Record<string, string>> {
  const entries = await Promise.all(LCOV_FILES.map(async (file) => [file, await fileStamp(join(projectDir, file))] as const));
  return Object.fromEntries(entries.flatMap(([file, stamp]) => stamp === undefined ? [] : [[file, stamp] as const]));
}

async function completedCommand(stateFile: string): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as CoverageCommandState;
    return 'report' in state;
  } catch {
    return false;
  }
}

function combineJsPackagesReports(reports: PluginReport[]): PluginReport[] {
  const parts = reports.filter(({ slug, packageName }) => slug === JS_PACKAGES_SLUG && packageName === JS_PACKAGES_PACKAGE);
  if (parts.length !== 2 || parts[0].version !== parts[1].version) {
    return reports;
  }
  const [first, second] = parts;
  const audits = [...first.audits, ...second.audits];
  const groups = [...(first.groups ?? []), ...(second.groups ?? [])];
  if (new Set(audits.map(({ slug }) => slug)).size !== audits.length ||
    new Set(groups.map(({ slug }) => slug)).size !== groups.length) {
    return reports;
  }
  const combined = { ...first, audits, groups, duration: first.duration + second.duration };
  return reports.flatMap((report) => report === first ? [combined] : report === second ? [] : [report]);
}

export async function runPlannedPlugins(plan: IEngineConfig, onProgress?: TPluginProgress) {
  const { projectDir, modules } = plan.config;
  const preflight = plan.noData.filter(({ plugin }) => plugin !== 'project-info');
  const coverage = plan.plugins.find(({ slug }) => slug === 'coverage');
  const historyFile = join(plan.outputDir, 'coverage-command.json');
  const testReport = join(projectDir, TEST_RESULTS_FILE);
  let coverageTask = coverage;
  let testCommand: string | undefined;
  let originalStamps: Record<string, string> = {};

  if (coverage !== undefined) {
    const history = await readHistory(historyFile);
    const stamps = await lcovStamps(projectDir);
    originalStamps = stamps;
    const ready = 'rejected' in history
      ? LCOV_FILES.find((file) => stamps[file] !== undefined && stamps[file] !== history.rejected[file])
      : undefined;
    testCommand = ready === undefined ? plan.config.testCommand : undefined;
    if (ready === undefined && testCommand === undefined) {
      coverageTask = undefined;
      const hadFile = Object.keys(stamps).length > 0;
      preflight.push({
        plugin: 'coverage',
        code: hadFile ? 'stale-lcov' : 'no-lcov',
        reason: hadFile ? 'LCOV остался после неподтверждённого прогона тестов.' : 'Не найден отчёт LCOV.',
        action: 'Создайте свежий coverage/lcov.info или укажите testCommand в frontis.config.',
      });
    } else {
      coverageTask = {
        ...coverage,
        options: { reports: ready === undefined ? [] : [join(projectDir, ready)] } satisfies CoverageOptions,
      };
    }
  }

  const stateFile = testCommand === undefined ? undefined : join(plan.outputDir, `test-command.${randomUUID()}.json`);
  const tests: GuardedPlugin | undefined = modules.coverage.enabled &&
    (testCommand !== undefined || (await stat(testReport).catch(() => undefined))?.isFile())
    ? { ...modules.coverage, slug: 'tests', module: testAdapter, options: { testCommand, stateFile } satisfies TestCommandOptions }
    : undefined;
  if (coverageTask !== undefined && stateFile !== undefined) {
    coverageTask = {
      ...coverageTask,
      options: { reports: [], stateFile } satisfies CoverageOptions,
      preflight: async () => {
        const state = await stat(stateFile).catch(() => undefined);
        return state?.isFile() ? undefined : UNCONFIRMED_TEST_COMMAND;
      },
    };
    await writeFile(historyFile, JSON.stringify({ pending: true } satisfies LcovHistory));
  }

  const coverageTasks = [tests, coverageTask].filter((task) => task !== undefined);
  const plugins = coverage === undefined
    ? [...plan.plugins, ...coverageTasks]
    : plan.plugins.flatMap((plugin) => plugin === coverage ? coverageTasks : [plugin]);
  try {
    const { reports, noData } = await runGuardedPlugins(projectDir, plugins, preflight, onProgress);
    return { reports: combineJsPackagesReports(reports), noData };
  } finally {
    if (stateFile !== undefined) {
      try {
        const stamps = await lcovStamps(projectDir);
        const rejected = await completedCommand(stateFile)
          ? Object.fromEntries(Object.entries(stamps).filter(([file, stamp]) => originalStamps[file] === stamp))
          : stamps;
        if (Object.keys(rejected).length === 0) {
          await rm(historyFile, { force: true });
        } else {
          await writeFile(historyFile, JSON.stringify({ rejected } satisfies LcovHistory));
        }
      } finally {
        await rm(stateFile, { force: true });
      }
    }
  }
}
