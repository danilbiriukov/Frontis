import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';
import { runGuardedPlugins } from '../dist/core/plugin-guard.js';

const root = join(import.meta.dirname, '..');
const disabled = { enabled: false };
const isolated = { knip: disabled, 'node-version': disabled, 'build-size': disabled };
const ignoreConfigFiles = "{ ignores: ['**/eslint.config.*', '**/frontis.config.*', '**/.frontis/**'] }";

async function project(t, files, { prettier = false } = {}) {
  const cache = join(root, '.cache');
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, 'frontis-quality-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const modules = prettier ? isolated : { ...isolated, prettier: disabled };
  const fixture = {
    'package.json': '{ "name": "quality", "type": "module" }\n',
    'frontis.config.mjs': `export default ${JSON.stringify({ modules })};\n`,
    ...files,
  };
  for (const [file, content] of Object.entries(fixture)) {
    const path = join(dir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return dir;
}

function run(dir) {
  const result = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), 'run'], { cwd: dir, encoding: 'utf8' });
  const json = async (file) => JSON.parse(await readFile(join(dir, '.frontis', file), 'utf8'));
  return { ...result, json };
}

function codeQuality(result) {
  const indicator = result.indicators.find(({ id }) => id === 'codeQuality');
  const lint = indicator.checks.find(({ id }) => id === 'lint');
  return { indicator, lint };
}

test('чистый запуск ESLint подтверждает проверенные файлы и нулевые счётчики', async (t) => {
  const dir = await project(t, {
    'eslint.config.mjs': `export default [${ignoreConfigFiles}, { rules: { 'no-console': 'warn' } }];\n`,
    'src/index.js': 'export const value = 1;\n',
  });
  const runResult = run(dir);
  assert.equal(runResult.status, 0, runResult.stderr);
  const { lint } = codeQuality(await runResult.json('result.json'));
  assert.equal(lint.status, 'ok');
  assert.deepEqual(lint.facts, { checkedFiles: 1, parseErrors: 0, errors: 0, warnings: 0 });
});

test('официальные аудиты учитывают разные параметры правила и сохраняют ошибки разбора', async (t) => {
  const dir = await project(t, {
    'eslint.config.mjs': `export default [
      ${ignoreConfigFiles},
      { files: ['src/a.js'], rules: { 'no-console': ['warn', { allow: ['warn'] }], 'no-unused-vars': 'error' } },
      { files: ['src/b.js'], rules: { 'no-console': ['warn', { allow: ['info'] }], 'no-unused-vars': 'error' } },
    ];\n`,
    'src/a.js': "const unused = 1;\nconsole.log('a');\n",
    'src/b.js': "console.log('b');\n",
    'src/broken.js': 'const = ;\n',
  }, { prettier: true });
  const runResult = run(dir);
  assert.equal(runResult.status, 0, runResult.stderr);
  const report = reportSchema.parse(await runResult.json('report.json'));
  const eslint = report.plugins.find(({ slug }) => slug === 'eslint');
  assert.equal(eslint.packageName, '@code-pushup/eslint-plugin');
  const parameterized = eslint.audits.filter(({ slug }) => slug.startsWith('no-console-'));
  assert.equal(new Set(parameterized.map(({ slug }) => slug)).size, 2);
  assert(parameterized.every(({ value }) => value === 1));
  const { lint, indicator } = codeQuality(await runResult.json('result.json'));
  assert.equal(indicator.status, 'fix');
  assert.equal(indicator.incomplete, true);
  assert.deepEqual(lint.facts, { checkedFiles: 3, parseErrors: 1, errors: 2, warnings: 2 });
  assert.deepEqual(lint.details.rules, [{ rule: 'no-console', count: 2 }, { rule: 'no-unused-vars', count: 1 }]);
  const parseError = lint.details.issues.find(({ audit }) => audit === 'eslint/frontis-parse-errors');
  assert.match(parseError.source.file, /\/src\/broken\.js$/);
  assert.equal(parseError.source.position.startLine, 1);
});

test('пропуск ESLint по отсутствию файлов отличается от отсутствия конфигурации', async (t) => {
  const dir = await project(t, {
    'eslint.config.mjs': "export default [{ ignores: ['**/*'] }];\n",
    'src/index.js': 'export const value = 1;\n',
  });
  const runResult = run(dir);
  assert.equal(runResult.status, 2, runResult.stdout);
  const noData = await runResult.json('no-data.json');
  assert.equal(noData.find(({ plugin }) => plugin === 'lint').code, 'no-files');
  assert.equal(noData.find(({ plugin }) => plugin === 'prettier').code, 'disabled');
});

test('шаблон ESLint без совпадений не даёт успешный нулевой аудит', async (t) => {
  const dir = await project(t, {
    'eslint.config.mjs': "export default [{ rules: { 'no-console': 'warn' } }];\n",
    'src/index.js': "console.log('demo');\n",
  });
  const { reports, noData } = await runGuardedPlugins(dir, [{
    slug: 'lint',
    enabled: true,
    timeoutMs: 30_000,
    module: new URL('../dist/plugins/eslint.js', import.meta.url).href,
    options: { eslintrc: join(dir, 'eslint.config.mjs'), patterns: 'src/absent-*.js' },
  }]);
  assert.deepEqual(reports, []);
  assert.equal(noData[0].code, 'no-files');
});

test('ESLint применяет правила из .eslintrc.json', async (t) => {
  const dir = await project(t, {
    '.eslintrc.json': JSON.stringify({ root: true, env: { es2022: true }, rules: { 'no-console': 'warn' } }),
    'src/index.js': "console.log('demo');\n",
  });
  const runResult = run(dir);
  assert.equal(runResult.status, 0, runResult.stderr);
  const { lint } = codeQuality(await runResult.json('result.json'));
  assert.equal(lint.status, 'plan');
  assert.equal(lint.facts.warnings, 1);
});

test('Prettier сохраняет находки, если конфигурация ESLint отсутствует', async (t) => {
  const dir = await project(t, {
    '.prettierrc': '{}\n',
    'src/index.js': 'export const value=1\n',
  }, { prettier: true });
  const runResult = run(dir);
  assert.equal(runResult.status, 0, runResult.stderr);
  const { indicator, lint } = codeQuality(await runResult.json('result.json'));
  const prettier = indicator.checks.find(({ id }) => id === 'prettier');
  assert.equal(indicator.status, 'plan');
  assert.equal(indicator.incomplete, true);
  assert.equal(lint.code, 'no-eslint-config');
  assert(prettier.facts.unformatted > 0);
});
