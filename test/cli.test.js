import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');
const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));

const frontis = (args, cwd = import.meta.dirname, env = {}) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FRONTIS_TEST_SKIP_OPEN: '1', ...env } });

test('--help выводит справку', () => {
  const { status, stdout } = frontis(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /frontis run/);
});

test('без аргументов выводит справку', () => {
  assert.match(frontis([]).stdout, /frontis run/);
});

test('--version выводит версию из package.json', () => {
  const { status, stdout } = frontis(['--version']);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), version);
});

test('неизвестная команда — код 2 и подсказка', () => {
  const { status, stderr } = frontis(['foo']);
  assert.equal(status, 2);
  assert.match(stderr, /frontis --help/);
});

test('run --help выводит справку и не запускает проверки', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  try {
    const { status, stdout, stderr } = frontis(['run', '--help'], dir);
    assert.equal(status, 0);
    assert.match(stdout, /frontis run/);
    assert.equal(stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run с неизвестным флагом — код 2 и имя флага', () => {
  const { status, stderr } = frontis(['run', '--no-such-flag'], join(import.meta.dirname, 'fixtures', 'cjs-ts'));
  assert.equal(status, 2);
  assert.match(stderr, /Неизвестный аргумент: --no-such-flag/);
});

test('run без конфига — понятное сообщение без стека', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  try {
    const { status, stderr } = frontis(['run'], dir);
    assert.equal(status, 2);
    assert.match(stderr, /Файл конфигурации не найден/);
    assert.doesNotMatch(stderr, /\s+at\s/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run без доступных аудитов возвращает 2 и сохраняет причины', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outputDir = join(dir, '.frontis');
  mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'report.json'), '{"previous":true}');
  writeFileSync(join(outputDir, 'result.json'), '{"previous":true}');
  writeFileSync(join(outputDir, 'report.html'), '<html>Предыдущий результат</html>');
  writeFileSync(join(dir, 'frontis.config.mjs'), 'export default {};');
  const { status, stdout } = frontis(['run'], dir);
  assert.equal(status, 2);
  assert.match(stdout, /frontis\.config\.mjs/);
  assert.match(stdout, /Аудиты Frontis: 0\. Модули без данных: 8\. Успешные проверки: 0\. Ошибки: 0\./);
  assert.match(stdout, /Диагностический отчёт:.*report\.html/);
  const html = readFileSync(join(outputDir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /Предыдущий результат/);
  assert.ok(html.includes(`Frontis v${version}`));
  const noData = JSON.parse(readFileSync(join(outputDir, 'no-data.json'), 'utf8'));
  assert.deepEqual(Object.fromEntries(noData.map(({ plugin, code }) => [plugin, code])), {
    outdated: 'no-package-json',
    audit: 'no-package-json',
    lint: 'no-eslint-config',
    coverage: 'no-lcov',
    knip: 'knip-not-installed',
    prettier: 'prettier-not-installed',
    'node-version': 'no-node-version',
    'build-size': 'no-build-dir',
  });
  assert.equal(existsSync(join(outputDir, 'report.json')), false);
  assert.equal(existsSync(join(outputDir, 'result.json')), false);
});

test('run собирает аудиты сборки вне Git и продолжает после пропусков', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'frontis.config.mjs'), "export default { modules: { 'node-version': { enabled: false } } };");
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export {};');
  const { status, stdout, stderr } = frontis(['run'], dir);
  assert.equal(status, 0, stderr);
  assert.match(stdout, /^\[build-size\] ожидает$/m);
  assert.match(stdout, /\[build-size\] запущен\r?\n\[build-size\] готово/);
  assert.match(stdout, /^\[lint\] нет данных$/m);
  const outputDir = join(dir, '.frontis');
  assert.match(stdout, /Аудиты Frontis: 3\. Модули без данных: 7\. Успешные проверки: 1\. Ошибки: 0\./);
  assert.match(stdout, /Отчёт:.*report\.html/);
  assert.equal(existsSync(join(outputDir, 'report.html')), true);
  assert.equal(stdout.includes('\x1b'), false);
  const noData = JSON.parse(readFileSync(join(outputDir, 'no-data.json'), 'utf8'));
  assert.deepEqual(Object.fromEntries(noData.map(({ plugin, code }) => [plugin, code])), {
    outdated: 'no-package-json',
    audit: 'no-package-json',
    lint: 'no-eslint-config',
    coverage: 'no-lcov',
    'node-version': 'disabled',
    knip: 'knip-not-installed',
    prettier: 'prettier-not-installed',
  });
  const report = reportSchema.parse(JSON.parse(readFileSync(join(outputDir, 'report.json'), 'utf8')));
  const result = JSON.parse(readFileSync(join(outputDir, 'result.json'), 'utf8'));
  assert.equal(report.commit, null);
  assert.deepEqual(report.plugins.map(({ slug }) => slug), ['frontis-build-size']);
  assert.equal(result.runAt, report.date);
  assert.equal(result.report.file, 'report.json');
  assert.equal(result.tool.version, version);
  assert.equal(result.project.commit, null);
  assert.equal(result.score.known, 1);
  assert.equal(result.indicators.find(({ id }) => id === 'buildSize').status, 'ok');
  assert.equal(existsSync(join(dir, '.git')), false);

  writeFileSync(join(dir, 'dist', 'index.js'), 'export const updated = true;');
  const repeated = frontis(['run'], dir);
  assert.equal(repeated.status, 0, repeated.stderr);
  const latest = reportSchema.parse(JSON.parse(readFileSync(join(outputDir, 'report.json'), 'utf8')));
  assert.notEqual(latest.date, report.date);
  assert.equal(latest.plugins[0].audits.find(({ slug }) => slug === 'size-bytes').value, 28);
  assert.match(readFileSync(join(outputDir, 'report.html'), 'utf8'), /28 Б/);
});

test('run отклоняет outFile, занятый служебными файлами, до запуска проверок', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, '.frontis');
  mkdirSync(output);
  writeFileSync(join(output, 'report.json'), '{"previous":true}');
  const filename = process.platform === 'win32' ? 'REPORT.JSON' : 'report.json';
  writeFileSync(join(dir, 'frontis.config.mjs'), `export default { outFile: '.frontis/${filename}' };`);

  const { status, stderr } = frontis(['run'], dir);
  assert.equal(status, 2);
  assert.match(stderr, /outFile.*служебн/);
  assert.equal(readFileSync(join(output, 'report.json'), 'utf8'), '{"previous":true}');
});

test('run возвращает 2, если каталог результатов недоступен', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'frontis.config.mjs'), 'export default {};');
  const outputPath = join(dir, '.frontis');
  writeFileSync(outputPath, 'занято');
  const { status, stderr } = frontis(['run'], dir);
  assert.equal(status, 2);
  assert.match(stderr, /\.frontis/);
  assert.equal(readFileSync(outputPath, 'utf8'), 'занято');
});

test('cli.js запускается напрямую через shebang', { skip: process.platform === 'win32' }, () => {
  accessSync(cli, constants.X_OK);
  const { status, stdout } = spawnSync(cli, ['--version'], { encoding: 'utf8' });
  assert.equal(status, 0);
  assert.equal(stdout.trim(), version);
});

test('run с ошибкой в конфиге — код 2, имя поля и без стека', () => {
  const { status, stderr } = frontis(['run'], join(import.meta.dirname, 'fixtures', 'cjs-ts'));
  assert.equal(status, 2);
  assert.match(stderr, /name: неизвестное поле/);
  assert.doesNotMatch(stderr, /\s+at\s/);
});

test('run с флагом --open принимает опцию и завершает проверку', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  writeFileSync(join(dir, 'frontis.config.mjs'), "export default { modules: { 'node-version': { enabled: false } } };");
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export {};');
  const { status, stdout } = frontis(['run', '--open'], dir);
  assert.equal(status, 0);
  assert.match(stdout, /Отчёт:.*report\.html/);
  assert.equal(existsSync(join(dir, '.frontis', 'report.html')), true);
});

test('run --fail-on учитывает статусы показателей и сохраняет отчёт', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'frontis.config.mjs');
  writeFileSync(config, "export default { modules: { 'node-version': { enabled: false } } };");
  const coverage = join(dir, 'lcov.info');
  writeFileSync(coverage, 'TN:\nSF:src/index.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nDA:5,0\nLF:5\nLH:4\nend_of_record\n');

  const plan = frontis(['run', '--fail-on', 'plan'], dir);
  assert.equal(plan.status, 1, plan.stderr);
  assert.equal(existsSync(join(dir, '.frontis', 'report.html')), true);
  assert.equal(frontis(['run', '--fail-on', 'fix'], dir).status, 0);

  writeFileSync(coverage, 'TN:\nSF:src/index.js\nDA:1,0\nLF:1\nLH:0\nend_of_record\n');
  assert.equal(frontis(['run', '--fail-on', 'fix'], dir).status, 1);

  rmSync(coverage);
  const failed = frontis(['run', '--fail-on', 'plan'], dir);
  assert.equal(failed.status, 2, failed.stderr);
  assert.match(failed.stdout, /Диагностический отчёт/);
  assert.equal(existsSync(join(dir, '.frontis', 'result.json')), false);
});

test('run --fail-on отклоняет отсутствующий или неподдерживаемый порог', () => {
  for (const args of [[], ['ok'], ['no-data']]) {
    const { status, stderr } = frontis(['run', '--fail-on', ...args]);
    assert.equal(status, 2);
    assert.match(stderr, /--fail-on.*plan.*fix/);
  }
});

test('open использует outFile и открывает сохранённый отчёт без аудита', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'frontis.config.mjs'), "export default { outFile: 'прошлый отчёт.html' };");
  const report = join(dir, 'прошлый отчёт.html');

  const missing = frontis(['open'], dir);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Отчёт не найден/);
  mkdirSync(report);
  assert.equal(frontis(['open'], dir).status, 2);
  rmSync(report, { recursive: true });

  writeFileSync(report, '<html>Готовый отчёт</html>');
  const opened = frontis(['open'], dir);
  assert.equal(opened.status, 0, opened.stderr);
  assert.match(opened.stdout, /прошлый отчёт\.html/);
  assert.equal(readFileSync(report, 'utf8'), '<html>Готовый отчёт</html>');
  assert.equal(existsSync(join(dir, '.frontis')), false);
});

test('open сообщает путь к файлу, если системная команда не открыла отчёт', {
  skip: process.platform !== 'linux',
}, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'frontis.config.mjs'), "export default { outFile: 'отчёт.html' };");
  writeFileSync(join(dir, 'отчёт.html'), '<html>Готовый отчёт</html>');
  writeFileSync(join(dir, 'xdg-open'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });

  const { status, stderr } = frontis(['open'], dir, { FRONTIS_TEST_SKIP_OPEN: '0', PATH: dir });
  assert.equal(status, 2);
  assert.match(stderr, /Не удалось открыть отчёт.*отчёт\.html/);
});
