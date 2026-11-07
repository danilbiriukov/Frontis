import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Collector, CollectorFailure, CollectorFinding } from './index.js';

export interface TestResultsData {
  format: 'jest' | 'vitest';
  passed: number;
  failed: number;
  /** Пропущенные, todo и отключённые тесты. */
  skipped: number;
  total: number;
  failedTests: { name: string; file: string; line?: number; message: string }[];
  /** Файлы тестов, которые не удалось выполнить. */
  failedSuites: { file: string; message: string }[];
  /** false, если прогон прерван или часть файлов не выполнилась. */
  complete: boolean;
}

export interface TestResultsOptions {
  /** Путь к JSON-отчёту Jest или Vitest от корня проекта. */
  reportFile: string;
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(status: CollectorFailure['status'], code: string, reason: string, action: string, cause?: unknown): CollectorFailure {
  return { status, code, reason, action, ...(cause === undefined ? {} : { cause }) };
}

function firstLine(message: unknown): string {
  if (typeof message !== 'string') return '';
  return stripVTControlCharacters(message).split('\n').map((line) => line.replace(/^\s*●\s*/, '').trim()).find((line) => line !== '' && line !== 'Test suite failed to run') ?? '';
}

function toPath(projectDir: string, file: string): string {
  const path = relative(projectDir, resolve(projectDir, file));
  return (isAbsolute(path) ? file : path).split(sep).join('/');
}

export function parseTestReport(report: unknown, projectDir: string): TestResultsData | undefined {
  if (!isFields(report) || !Array.isArray(report['testResults'])) return undefined;
  const format = 'numRuntimeErrorTestSuites' in report || 'wasInterrupted' in report ? 'jest' : 'vitest';
  const data: TestResultsData = { format, passed: 0, failed: 0, skipped: 0, total: 0, failedTests: [], failedSuites: [], complete: report['wasInterrupted'] !== true };

  for (const suite of report['testResults']) {
    if (!isFields(suite) || typeof suite['name'] !== 'string') return undefined;
    const file = toPath(projectDir, suite['name']);
    const assertions = suite['assertionResults'] ?? [];
    if (!Array.isArray(assertions)) return undefined;

    for (const test of assertions) {
      if (!isFields(test) || typeof test['status'] !== 'string') return undefined;
      data.total += 1;
      if (test['status'] === 'passed') {
        data.passed += 1;
      } else if (test['status'] === 'failed') {
        data.failed += 1;
        const location = test['location'];
        const line = isFields(location) && typeof location['line'] === 'number' && location['line'] > 0 ? location['line'] : undefined;
        const name = typeof test['fullName'] === 'string' ? test['fullName'] : String(test['title'] ?? '');
        const messages = Array.isArray(test['failureMessages']) ? test['failureMessages'] : [];
        data.failedTests.push({ name, file, ...(line === undefined ? {} : { line }), message: firstLine(messages[0]) });
      } else {
        data.skipped += 1;
      }
    }

    if (suite['status'] === 'failed' && assertions.length === 0) {
      data.failedSuites.push({ file, message: firstLine(suite['message']) || 'Файл тестов не выполнился' });
      data.complete = false;
    }
  }
  return data;
}

export function createTestResultsCollector(options: TestResultsOptions): Collector<TestResultsData> {
  return async ({ projectDir }) => {
    const reportFile = resolve(projectDir, options.reportFile);
    let content: string;
    try {
      content = await readFile(reportFile, 'utf8');
    } catch (error) {
      return failure('no-data', 'no-test-report', `Нет отчёта о прогоне тестов: ${toPath(projectDir, reportFile)}`, 'Запустите тесты с JSON-отчётом, например vitest run --reporter=json --outputFile=<путь> или jest --json --outputFile=<путь>.', error);
    }

    let data: TestResultsData | undefined;
    try {
      data = parseTestReport(JSON.parse(content), projectDir);
    } catch (error) {
      return failure('error', 'invalid-test-report', 'Отчёт о прогоне тестов повреждён', 'Перезапустите тесты: файл отчёта не является корректным JSON.', error);
    }
    if (data === undefined) {
      return failure('error', 'invalid-test-report', 'Отчёт о прогоне тестов не в формате Jest или Vitest', 'Используйте jest --json или vitest --reporter=json.');
    }
    if (data.total === 0 && data.failedSuites.length === 0) {
      return failure('no-data', 'no-tests', 'В отчёте нет ни одного теста', 'Проверьте, что тесты находятся и запускаются.');
    }

    const findings: CollectorFinding[] = [
      ...data.failedTests.map(({ name, file, line, message }): CollectorFinding => ({
        code: 'failed-test',
        message: message ? `${name}: ${message}` : name,
        severity: 'error',
        source: { file, ...(line === undefined ? {} : { position: { startLine: line } }) },
      })),
      ...data.failedSuites.map(({ file, message }): CollectorFinding => ({
        code: 'failed-test-suite',
        message,
        severity: 'error',
        source: { file },
      })),
    ];
    return { status: 'ok', data, findings };
  };
}
