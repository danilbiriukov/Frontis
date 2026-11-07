import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createTestResultsCollector, parseTestReport } from '../dist/index.js';

const fixturesDir = fileURLToPath(new URL('./fixtures/test-results', import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
const collect = (reportFile) => createTestResultsCollector({ reportFile })({ projectDir: fixturesDir });

for (const format of ['jest', 'vitest']) {
  test(`${format}: счётчики, упавшие тесты и файлы, которые не выполнились`, () => {
    const data = parseTestReport(fixture(`${format}.json`), '/project');
    assert.equal(data.format, format);
    assert.deepEqual([data.passed, data.failed, data.skipped, data.total], [1, 1, 2, 4]);
    assert.equal(data.failedTests.length, 1);
    const [failed] = data.failedTests;
    assert.equal(failed.name, 'math fails');
    assert.equal(failed.file, 'src/math.test.js');
    assert.match(failed.message, /expect|expected/i);
    assert.deepEqual(data.failedSuites, [{ file: 'src/broken.test.js', message: 'suite crashed' }]);
    assert.equal(data.complete, false);
  });
}

test('jest: строка упавшего теста из --testLocationInResults', () => {
  const data = parseTestReport(fixture('jest.json'), '/project');
  assert.equal(data.failedTests[0].line, 3);
});

test('находки содержат упавшие тесты и файлы, которые не выполнились', async () => {
  const result = await collect('vitest.json');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.findings.map(({ code, severity }) => [code, severity]), [
    ['failed-test', 'error'],
    ['failed-test-suite', 'error'],
  ]);
  assert.match(result.findings[0].message, /^math fails: /);
});

test('прерванный прогон Jest отмечается как неполный, упавшие тесты сохраняются', () => {
  const report = fixture('jest.json');
  report.wasInterrupted = true;
  report.testResults = report.testResults.filter(({ name }) => name.endsWith('math.test.js'));
  const data = parseTestReport(report, '/project');
  assert.equal(data.complete, false);
  assert.deepEqual(data.failedSuites, []);
  assert.equal(data.failedTests[0].name, 'math fails');
});

test('относительные пути в отчёте считаются от корня проекта', () => {
  const report = fixture('vitest.json');
  for (const suite of report.testResults) suite.name = suite.name.replace('/project/', '');
  const data = parseTestReport(report, '/project');
  assert.deepEqual(data.failedSuites, [{ file: 'src/broken.test.js', message: 'suite crashed' }]);
});

test('полный прогон без падений отмечается как полный', () => {
  const report = fixture('vitest.json');
  report.testResults = report.testResults
    .filter(({ name }) => name.endsWith('math.test.js'))
    .map((suite) => ({ ...suite, status: 'passed', assertionResults: suite.assertionResults.filter(({ status }) => status !== 'failed') }));
  const data = parseTestReport(report, '/project');
  assert.deepEqual([data.passed, data.failed, data.skipped], [1, 0, 2]);
  assert.equal(data.complete, true);
});

test('отсутствующий отчёт даёт «Нет данных», а не нули', async () => {
  const result = await collect('missing.json');
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-test-report');
  assert.match(result.reason, /missing\.json/);
});

test('повреждённый отчёт даёт ошибку', async () => {
  const result = await collect('broken.json');
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'invalid-test-report');
});

test('отчёт не в формате Jest или Vitest не принимается', () => {
  for (const report of [null, [], {}, { testResults: {} }, { testResults: [{}] }, { testResults: [{ name: 'a', assertionResults: [{}] }] }]) {
    assert.equal(parseTestReport(report, '/project'), undefined);
  }
});

test('отчёт без тестов даёт «Нет данных»', async (t) => {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-test-results-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  await writeFile(join(projectDir, 'report.json'), '{"testResults":[]}');
  const result = await createTestResultsCollector({ reportFile: 'report.json' })({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-tests');
});
