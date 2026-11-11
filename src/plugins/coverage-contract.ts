import { stat } from 'node:fs/promises';
import type { PluginProblem } from '../core/plugin-guard.js';

export const LCOV_FILES = ['coverage/lcov.info', 'lcov.info'] as const;
export const TEST_RESULTS_FILE = '.frontis/test-results.json';
export const LCOV_DATE_AUDIT = 'frontis-lcov-date';

export const UNCONFIRMED_TEST_COMMAND: PluginProblem = {
  code: 'test-command-unconfirmed',
  reason: 'Не удалось подтвердить завершение команды тестов.',
  action: 'Проверьте диагностику прогона тестов.',
};

export interface CoverageOptions {
  reports: string[];
  testCommand?: string;
  stateFile?: string;
}

export interface TestCommandOptions {
  testCommand?: string;
  stateFile?: string;
}

export type CoverageCommandState = { report: string } | { problem: PluginProblem; diagnostic?: string };

export async function fileStamp(file: string): Promise<string | undefined> {
  try {
    const info = await stat(file, { bigint: true });
    return info.isFile() ? `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` : undefined;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  }
}
