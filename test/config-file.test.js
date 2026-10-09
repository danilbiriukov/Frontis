import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError, findConfigFile, loadConfigFile } from '../dist/core/config-file.js';

const fixture = (name) => join(import.meta.dirname, 'fixtures', name);

const loads = [
  ['esm-ts', 'frontis.config.ts', 'ts'],
  ['cjs-ts', 'frontis.config.ts', 'ts'],
  ['esm-js', 'frontis.config.js', 'esm-js'],
  ['cjs-js', 'frontis.config.js', 'cjs-js'],
  ['cjs-js-esm-syntax', 'frontis.config.js', 'cjs-js-esm-syntax'],
  ['mjs', 'frontis.config.mjs', 'mjs'],
];

for (const [dir, file, name] of loads) {
  test(`читает ${file} в проекте ${dir}`, async () => {
    const path = findConfigFile(fixture(dir));
    assert.equal(path, join(fixture(dir), file));
    assert.deepEqual(await loadConfigFile(path), { name });
  });
}

test('без файла конфигурации — ошибка', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontis-'));
  try {
    assert.throws(() => findConfigFile(dir), ConfigError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('несколько файлов конфигурации — ошибка с их названиями', () => {
  assert.throws(() => findConfigFile(fixture('multiple')), {
    name: 'ConfigError',
    message: /frontis\.config\.ts, frontis\.config\.js/,
  });
});

test('синтаксическая ошибка в конфиге — ConfigError с названием файла', async () => {
  await assert.rejects(loadConfigFile(join(fixture('broken'), 'frontis.config.js')), {
    name: 'ConfigError',
    message: /frontis\.config\.js/,
  });
});
