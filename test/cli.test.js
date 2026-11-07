import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

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
  writeFileSync(join(dir, 'frontis.config.mjs'), 'export default {};');
  const { status, stdout } = frontis(['run'], dir);
  assert.equal(status, 2);
  assert.match(stdout, /frontis\.config\.mjs/);
  assert.match(stdout, /Аудиты Frontis: 0/);
  const noData = JSON.parse(readFileSync(join(dir, '.frontis', 'no-data.json'), 'utf8'));
  assert.deepEqual(Object.fromEntries(noData.map(({ plugin, code }) => [plugin, code])), {
    knip: 'knip-not-installed',
    prettier: 'prettier-not-installed',
    'node-version': 'no-node-version',
    'build-size': 'no-build-dir',
  });
});

test('run собирает аудиты сборки вне Git и продолжает после пропусков', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'frontis.config.mjs'), "export default { modules: { 'node-version': { enabled: false } } };");
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export {};');
  const { status, stdout, stderr } = frontis(['run'], dir);
  assert.equal(status, 0, stderr);
  assert.match(stdout, /Аудиты Frontis: 3\. Модули без данных: 3/);
  const noData = JSON.parse(readFileSync(join(dir, '.frontis', 'no-data.json'), 'utf8'));
  assert.deepEqual(Object.fromEntries(noData.map(({ plugin, code }) => [plugin, code])), {
    'node-version': 'disabled',
    knip: 'knip-not-installed',
    prettier: 'prettier-not-installed',
  });
  assert.equal(existsSync(join(dir, '.git')), false);
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
