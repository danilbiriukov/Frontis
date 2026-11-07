import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { collectPrettier } from '../dist/index.js';

// Проект создаётся внутри репозитория, чтобы Prettier находился в node_modules Frontis,
// и пишется при запуске, чтобы Git не менял переводы строк в файлах
const cacheDir = fileURLToPath(new URL('../.cache', import.meta.url));

async function project(t, files, parent = cacheDir) {
  await mkdir(parent, { recursive: true });
  const projectDir = await mkdtemp(join(parent, 'frontis-prettier-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({ 'package.json': json({ name: 'demo' }), ...files })) {
    await mkdir(dirname(join(projectDir, file)), { recursive: true });
    await writeFile(join(projectDir, file), content);
  }
  return projectDir;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const formatted = "export const value = 'a';\n";
const unformatted = 'export const value   =  "a"\n';

test('prettier: учитываются настройки и исключения проекта', async (t) => {
  const projectDir = await project(t, {
    '.prettierrc': '{ "singleQuote": true }\n',
    '.prettierignore': 'ignored.js\nvendor/\n',
    '.gitignore': 'generated/\n',
    'src/formatted.js': formatted,
    'src/unformatted.js': unformatted,
    'src/double-quotes.js': 'export const value = "a";\n',
    'ignored.js': unformatted,
    'vendor/lib.js': unformatted,
    'generated/out.js': unformatted,
    'notes.txt': 'не форматируется   Prettier\n',
  });
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.checkedFiles, 5);
  assert.deepEqual(result.data.unformatted, ['src/double-quotes.js', 'src/unformatted.js']);
  assert.deepEqual(result.data.errors, []);
  assert.equal(result.data.configFile, '.prettierrc');
  assert.match(result.data.prettierVersion, /^3\./);
  assert.deepEqual(result.findings.map(({ code, severity, source }) => [code, severity, source]), [
    ['unformatted-file', 'warning', { file: 'src/double-quotes.js' }],
    ['unformatted-file', 'warning', { file: 'src/unformatted.js' }],
  ]);
});

test('prettier: проверка без нарушений успешна', async (t) => {
  const projectDir = await project(t, { '.prettierrc': '{}\n', 'src/a.js': 'export const a = 1;\n' });
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.checkedFiles, 3);
  assert.deepEqual(result.data.unformatted, []);
  assert.deepEqual(result.findings, []);
});

test('prettier: настройки в package.json учитываются', async (t) => {
  const projectDir = await project(t, {
    'package.json': json({ name: 'demo', prettier: { semi: false } }),
    'a.js': 'export const a = 1\n',
  });
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.configFile, 'package.json');
  assert.deepEqual(result.data.unformatted, []);
});

test('prettier: файл с синтаксической ошибкой не считается отформатированным', async (t) => {
  const projectDir = await project(t, { '.prettierrc': '{}\n', 'broken.js': 'export const = ;\n' });
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.errors.map(({ file }) => file), ['broken.js']);
  assert.deepEqual(result.findings.map(({ code, severity }) => [code, severity]), [['prettier-error', 'error']]);
});

test('prettier: без настроек возвращается «Нет данных»', async (t) => {
  const projectDir = await project(t, { 'a.js': formatted });
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-prettier-config');
});

test('prettier: ноль проверенных файлов отличается от успешной проверки', async (t) => {
  const projectDir = await project(t, { '.prettierrc': '{}\n', '.prettierignore': '*\n', 'a.js': formatted });
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-files');
});

test('prettier: без установленного Prettier возвращается «Нет данных»', async (t) => {
  const projectDir = await project(t, { '.prettierrc': '{}\n' }, tmpdir());
  const result = await collectPrettier({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'prettier-not-installed');
});
