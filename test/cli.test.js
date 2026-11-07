import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');
const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));

const frontis = (args, cwd = import.meta.dirname) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

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
  writeFileSync(join(dir, 'frontis.config.mjs'), 'export default {};');
  const { status, stdout } = frontis(['run'], dir);
  assert.equal(status, 2);
  assert.match(stdout, /frontis\.config\.mjs/);
  assert.match(stdout, /Аудиты Frontis: 0\. Модули без данных: 8\. Успешные проверки: 0\. Ошибки: 0\./);
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
  assert.match(stdout, /Аудиты Frontis: 3\. Модули без данных: 7\. Успешные проверки: 1\. Ошибки: 0\./);
  assert.equal(stdout.includes('\x1b'), false);
  const outputDir = join(dir, '.frontis');
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
