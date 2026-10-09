import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('run с конфигом — код 0', () => {
  const { status, stdout } = frontis(['run'], join(import.meta.dirname, 'fixtures', 'cjs-ts'));
  assert.equal(status, 0);
  assert.match(stdout, /frontis\.config\.ts/);
});

test('cli.js запускается напрямую через shebang', { skip: process.platform === 'win32' }, () => {
  accessSync(cli, constants.X_OK);
  const { status, stdout } = spawnSync(cli, ['--version'], { encoding: 'utf8' });
  assert.equal(status, 0);
  assert.equal(stdout.trim(), version);
});
