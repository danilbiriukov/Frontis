import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');
const lcov = [
  'TN:', 'SF:src/index.js', 'FN:1,example', 'FNDA:1,example', 'FNF:1', 'FNH:1',
  'BRDA:1,0,0,1', 'BRDA:1,0,1,0', 'BRF:2', 'BRH:1',
  'DA:1,1', 'DA:2,0', 'LF:2', 'LH:1', 'end_of_record', '',
].join('\n');

function machineReport({ failed = false, jest = true } = {}) {
  return JSON.stringify({
    ...(jest ? { wasInterrupted: false } : {}),
    testResults: [{
      name: 'src/example.test.js',
      assertionResults: [
        failed ? {
          status: 'failed', fullName: 'example падает', location: { line: 7 },
          failureMessages: ['Error: контрольная ошибка'],
        } : { status: 'passed', fullName: 'example работает' },
        { status: 'pending', fullName: 'example пропущен' },
      ],
    }],
  });
}

async function project(t, files, { testCommand, timeoutMs } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'frontis-coverage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const modules = Object.fromEntries(
    ['knip', 'lint', 'prettier', 'node-version', 'build-size'].map((name) => [name, { enabled: false }])
  );
  if (timeoutMs !== undefined) {
    modules.coverage = { timeoutMs };
  }
  const fixture = {
    'package.json': '{ "name": "demo-coverage" }',
    'frontis.config.mjs': `export default ${JSON.stringify({ modules, testCommand })};\n`,
    'src/index.js': 'export const example = () => 1;\n',
    ...files,
  };
  for (const [file, content] of Object.entries(fixture)) {
    const target = join(dir, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dir;
}

function run(dir) {
  const output = spawnSync(process.execPath, [cli, 'run'], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
  const json = async (file) => JSON.parse(await readFile(join(dir, '.frontis', file), 'utf8'));
  return { ...output, json };
}

function reportWriter({ exit = 0, jest = true } = {}) {
  return [
    "const { writeFileSync } = require('node:fs');",
    `writeFileSync('lcov.info', ${JSON.stringify(lcov)});`,
    `writeFileSync('.frontis/test-results.json', ${JSON.stringify(machineReport({ failed: exit !== 0, jest }))});`,
    "console.error('Контрольный журнал прогона');",
    `process.exitCode = ${exit};`,
  ].join('\n');
}

test('готовый LCOV читается официальным плагином без запуска команды', async (t) => {
  const dir = await project(t, {
    'coverage/lcov.info': lcov,
    '.frontis/test-results.json': machineReport(),
    'should-not-run.cjs': "require('node:fs').writeFileSync('marker', 'запущено');",
  }, { testCommand: 'node should-not-run.cjs' });
  const output = run(dir);
  assert.equal(output.status, 0, output.stderr);
  await assert.rejects(stat(join(dir, 'marker')), { code: 'ENOENT' });
  const report = reportSchema.parse(await output.json('report.json'));
  const plugin = report.plugins.find(({ slug }) => slug === 'coverage');
  assert.equal(plugin.packageName, '@code-pushup/coverage-plugin');
  const audits = Object.fromEntries(plugin.audits.map(({ slug, value }) => [slug, value]));
  assert.equal(audits['line-coverage'], 50);
  assert.equal(audits['branch-coverage'], 50);
  assert.equal(audits['function-coverage'], 100);
  const result = await output.json('result.json');
  const indicator = result.indicators.find(({ id }) => id === 'coverage');
  const coverage = indicator.checks.find(({ id }) => id === 'coverage');
  const tests = indicator.checks.find(({ id }) => id === 'tests');
  assert.equal(coverage.facts.lines, 50);
  assert.equal(coverage.facts.gapToWarn, 15);
  assert.equal(coverage.facts.gapToTarget, 40);
  assert.equal(coverage.facts.reportDate, (await stat(join(dir, 'coverage/lcov.info'))).mtime.toISOString());
  assert.equal(tests.facts.passed, 1);
  assert.equal(tests.facts.skipped, 1);
});

test('успешная команда создаёт новый LCOV и отчёт Vitest', async (t) => {
  const dir = await project(t, { 'generate.cjs': reportWriter({ jest: false }) }, { testCommand: 'node generate.cjs' });
  const output = run(dir);
  assert.equal(output.status, 0, output.stderr);
  const report = reportSchema.parse(await output.json('report.json'));
  assert.deepEqual(report.plugins.map(({ slug }) => slug), ['frontis-tests', 'coverage']);
});

test('после сбоя команды сохраняются упавшие тесты и исключается покрытие', async (t) => {
  const dir = await project(t, { 'generate.cjs': reportWriter({ exit: 1 }) }, { testCommand: 'node generate.cjs' });
  const output = run(dir);
  assert.equal(output.status, 0, output.stderr);
  const report = reportSchema.parse(await output.json('report.json'));
  assert.deepEqual(report.plugins.map(({ slug }) => slug), ['frontis-tests']);
  const noData = (await output.json('no-data.json')).find(({ plugin }) => plugin === 'coverage');
  assert.equal(noData.code, 'test-command-failed');
  assert.match(await readFile(join(dir, '.frontis', noData.logFile), 'utf8'), /Контрольный журнал прогона/);
  const result = await output.json('result.json');
  const indicator = result.indicators.find(({ id }) => id === 'coverage');
  const coverage = indicator.checks.find(({ id }) => id === 'coverage');
  const tests = indicator.checks.find(({ id }) => id === 'tests');
  assert.equal(indicator.status, 'fix');
  assert.equal(indicator.incomplete, true);
  assert.equal(coverage.status, 'no-data');
  assert.equal(tests.facts.failed, 1);
  assert.equal(tests.facts.skipped, 1);
  assert.equal(tests.details.issues[0].source.position.startLine, 7);

  await writeFile(join(dir, 'generate.cjs'), "console.log('Команда выполнилась без записи отчётов');");
  const retry = run(dir);
  assert.equal(retry.status, 2, retry.stderr);
  const retryCodes = Object.fromEntries((await retry.json('no-data.json')).map(({ plugin, code }) => [plugin, code]));
  assert.equal(retryCodes.coverage, 'no-fresh-lcov');
  await assert.rejects(retry.json('report.json'), { code: 'ENOENT' });
});

test('прошлый JSON и отсутствующий LCOV не засчитываются после нового прогона', async (t) => {
  const dir = await project(t, {
    '.frontis/test-results.json': machineReport({ failed: true }),
    'generate.cjs': '',
  }, { testCommand: 'node generate.cjs' });
  const output = run(dir);
  assert.equal(output.status, 2, output.stderr);
  const codes = Object.fromEntries((await output.json('no-data.json')).map(({ plugin, code }) => [plugin, code]));
  assert.equal(codes.tests, 'no-fresh-test-report');
  assert.equal(codes.coverage, 'no-fresh-lcov');
  await assert.rejects(output.json('report.json'), { code: 'ENOENT' });
});

test('LCOV без измеренных строк, ветвей и функций не даёт оценку', async (t) => {
  const dir = await project(t, { 'lcov.info': 'TN:\nSF:src/index.js\nend_of_record\n' });
  const output = run(dir);
  assert.equal(output.status, 2, output.stderr);
  const noData = (await output.json('no-data.json')).find(({ plugin }) => plugin === 'coverage');
  assert.equal(noData.code, 'empty-lcov');
});

test('нулевое покрытие измеренных строк сохраняется без выдуманных ветвей и функций', async (t) => {
  const dir = await project(t, { 'lcov.info': 'TN:\nSF:src/index.js\nDA:1,0\nLF:1\nLH:0\nend_of_record\n' });
  const output = run(dir);
  assert.equal(output.status, 0, output.stderr);
  const report = reportSchema.parse(await output.json('report.json'));
  const coverage = report.plugins.find(({ slug }) => slug === 'coverage');
  assert.deepEqual(coverage.audits.map(({ slug }) => slug), ['line-coverage', 'frontis-lcov-date']);
  assert.equal(coverage.audits[0].value, 0);
});

test('тайм-аут команды тестов не пропускает LCOV незавершённого прогона', async (t) => {
  const dir = await project(t, {
    'generate.cjs': `require('node:fs').writeFileSync('lcov.info', ${JSON.stringify(lcov)});\nsetTimeout(() => {}, 30_000);`,
  }, { testCommand: 'node generate.cjs', timeoutMs: 5000 });
  const output = run(dir);
  assert.equal(output.status, 2, output.stderr);
  const codes = Object.fromEntries((await output.json('no-data.json')).map(({ plugin, code }) => [plugin, code]));
  assert.equal(codes.tests, 'timeout');
  assert.equal(codes.coverage, 'test-command-unconfirmed');
  assert((await stat(join(dir, 'lcov.info'))).isFile());
});
