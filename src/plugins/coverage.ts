import { copyFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import coveragePlugin from '@code-pushup/coverage-plugin';
import { parseLcovFiles } from '@code-pushup/coverage-plugin/src/lib/runner/lcov/lcov-runner.js';
import { recordToStatFunctionMapper } from '@code-pushup/coverage-plugin/src/lib/runner/lcov/transform.js';
import type { PluginConfig, RunnerFunction } from '@code-pushup/models';
import { CollectorRunError } from '../collectors/code-pushup.js';
import type { PluginProblem } from '../core/plugin-guard.js';
import { LCOV_DATE_AUDIT, type CoverageCommandState, type CoverageOptions } from './coverage-contract.js';

const noLcov: PluginProblem = {
  code: 'no-lcov',
  reason: 'Не найден пригодный отчёт LCOV.',
  action: 'Создайте coverage/lcov.info или укажите testCommand в frontis.config.',
};

async function selectedReport(options: CoverageOptions): Promise<string | PluginProblem> {
  if (options.stateFile === undefined) {
    return options.reports[0] ?? noLcov;
  }
  let state: CoverageCommandState;
  try {
    state = JSON.parse(await readFile(options.stateFile, 'utf8')) as CoverageCommandState;
  } catch {
    return {
      code: 'test-command-unconfirmed',
      reason: 'Не удалось подтвердить завершение команды тестов.',
      action: 'Проверьте диагностику прогона тестов.',
    };
  }
  if ('problem' in state) {
    const status = state.problem.code === 'test-command-failed' ? 'error' : 'no-data';
    throw new CollectorRunError({ status, ...state.problem, cause: state.diagnostic });
  }
  return state.report;
}

export async function prepare(options: CoverageOptions, outputDir: string): Promise<PluginConfig | PluginProblem> {
  const report = await selectedReport(options);
  if (typeof report !== 'string') {
    return report;
  }
  const snapshot = join(outputDir, 'lcov.info');
  try {
    const source = await stat(report);
    if (!source.isFile()) {
      return noLcov;
    }
    await copyFile(report, snapshot);
    const records = await parseLcovFiles([snapshot]);
    const coverageTypes = (['line', 'branch', 'function'] as const).filter((type) =>
      records.some((record) => recordToStatFunctionMapper[type](record).total > 0)
    );
    if (coverageTypes.length === 0) {
      return { ...noLcov, code: 'empty-lcov', reason: 'В отчёте LCOV нет измеренного покрытия.' };
    }
    const plugin = await coveragePlugin({ reports: [snapshot], coverageTypes });
    const runner = plugin.runner as RunnerFunction;
    return {
      ...plugin,
      audits: [...plugin.audits, { slug: LCOV_DATE_AUDIT, title: 'Время изменения отчёта LCOV' }],
      runner: async (context) => [
        ...await runner(context),
        { slug: LCOV_DATE_AUDIT, score: 1, value: 1, displayValue: source.mtime.toISOString() },
      ],
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return noLcov;
    }
    throw new CollectorRunError({
      status: 'error',
      code: 'invalid-lcov',
      reason: 'Не удалось прочитать отчёт LCOV.',
      action: 'Проверьте формат файла покрытия и повторите прогон тестов.',
      cause,
    });
  }
}
