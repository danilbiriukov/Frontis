import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginConfig } from '@code-pushup/models';
import { createCollectorRunner } from '../collectors/code-pushup.js';
import { createTestResultsCollector } from '../collectors/test-results.js';
import type { PluginProblem } from '../core/plugin-guard.js';
import {
  LCOV_FILES, TEST_RESULTS_FILE, fileStamp, type CoverageCommandState, type TestCommandOptions,
} from './coverage-contract.js';
import { countIssues } from './utils/issues.js';

const MAX_OUTPUT = 32 * 1024;

function executeTests(command: string, cwd: string): Promise<{ exit: number | string; diagnostic: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8').on('data', (chunk: string) => {
        diagnostic = (diagnostic + chunk).slice(-MAX_OUTPUT);
      });
    }
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ exit: code ?? signal ?? 'неизвестен', diagnostic }));
  });
}

async function commandState(command: string, cwd: string): Promise<CoverageCommandState> {
  const files = LCOV_FILES.map((file) => join(cwd, file));
  const before = await Promise.all(files.map(fileStamp));
  const run = await executeTests(command, cwd).catch((error: unknown) => ({
    exit: 'сбой запуска',
    diagnostic: String(error),
  }));
  if (run.exit !== 0) {
    return {
      problem: {
        code: 'test-command-failed',
        reason: `Команда тестов завершилась с ошибкой (${run.exit}).`,
        action: 'Проверьте итоги тестов и технический журнал.',
      },
      diagnostic: run.diagnostic,
    };
  }
  const after = await Promise.all(files.map(fileStamp));
  const report = files.find((_, index) => after[index] !== undefined && after[index] !== before[index]);
  if (report === undefined) {
    return {
      problem: {
        code: 'no-fresh-lcov',
        reason: 'Команда тестов не создала новый отчёт LCOV.',
        action: 'Настройте запись покрытия в coverage/lcov.info или lcov.info.',
      },
      diagnostic: run.diagnostic,
    };
  }
  return { report };
}

export async function prepare(options: TestCommandOptions): Promise<PluginConfig | PluginProblem> {
  const projectDir = process.cwd();
  const testReport = join(projectDir, TEST_RESULTS_FILE);
  if (options.testCommand !== undefined && options.stateFile !== undefined) {
    const before = await fileStamp(testReport);
    const state = await commandState(options.testCommand, projectDir);
    await writeFile(options.stateFile, JSON.stringify(state), { flag: 'wx' });
    const after = await fileStamp(testReport);
    if (after === undefined || before === after) {
      return {
        code: 'no-fresh-test-report',
        reason: 'Команда тестов не создала новый JSON-отчёт.',
        action: 'Настройте Jest или Vitest на запись .frontis/test-results.json.',
      };
    }
  }
  return {
    slug: 'frontis-tests',
    title: 'Итоги тестов',
    icon: 'file',
    audits: [
      { slug: 'passed-tests', title: 'Пройденные тесты' },
      { slug: 'failed-tests', title: 'Упавшие тесты' },
      { slug: 'skipped-tests', title: 'Пропущенные тесты' },
      { slug: 'failed-suites', title: 'Файлы тестов, которые не выполнились' },
      { slug: 'test-run-complete', title: 'Полнота отчёта о тестах' },
    ],
    runner: createCollectorRunner({ projectDir }, createTestResultsCollector({ reportFile: testReport }), ({ data, findings }) => [
      { slug: 'passed-tests', value: data.passed, score: 1 },
      countIssues('failed-tests', findings.filter(({ code }) => code === 'failed-test'), projectDir),
      { slug: 'skipped-tests', value: data.skipped, score: Number(data.skipped === 0) },
      countIssues('failed-suites', findings.filter(({ code }) => code === 'failed-test-suite'), projectDir),
      { slug: 'test-run-complete', value: Number(data.complete), score: Number(data.complete) },
    ]),
  };
}
