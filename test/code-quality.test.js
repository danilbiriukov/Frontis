import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';
import { runGuardedPlugins } from '../dist/core/plugin-guard.js';

const root = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
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

function run(dir, env = process.env) {
  const result = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), 'run'], { cwd: dir, encoding: 'utf8', env });
  const json = async (file) => JSON.parse(await readFile(join(dir, '.frontis', file), 'utf8'));
  return { ...result, json };
}

async function useEslint10(dir) {
  const eslintDir = dirname(require.resolve('eslint10/package.json'));
  await mkdir(join(dir, 'node_modules'));
  await symlink(eslintDir, join(dir, 'node_modules/eslint'), 'junction');
  return join(eslintDir, 'bin/eslint.js');
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

test('ESLint 10 находит конфигурацию от файла и даёт те же счётчики, что прямой запуск', async (t) => {
  const dir = await project(t, {
    'eslint.config.mjs': `export default [${ignoreConfigFiles}, { rules: {
      'no-console': ['warn', { allow: ['warn'] }],
      'no-unused-vars': 'error',
    } }];\n`,
    'src/nested/eslint.config.mjs': `export default [${ignoreConfigFiles}, { rules: {
      'no-console': ['error', { allow: ['info'] }],
    } }];\n`,
    'src/root.js': "const unused = 1;\nconsole.log('root');\n",
    'src/nested/entry.js': "console.warn('nested');\n",
    'src/broken.js': 'const = ;\n',
  });
  const bin = await useEslint10(dir);
  const direct = spawnSync(process.execPath, [bin, '.', '--format=json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(direct.status, 1, direct.stderr);
  const directResults = JSON.parse(direct.stdout);
  assert.equal(directResults.length, 3);
  const runResult = run(dir);
  assert.equal(runResult.status, 0, `${runResult.stdout}\n${runResult.stderr}`);
  const report = reportSchema.parse(await runResult.json('report.json'));
  const eslint = report.plugins.find(({ slug }) => slug === 'eslint');
  assert.equal(eslint.packageName, '@code-pushup/eslint-plugin');
  const noConsole = eslint.audits.filter(({ slug }) => slug.startsWith('no-console-'));
  assert.equal(noConsole.length, 2);
  assert(noConsole.every(({ value }) => value === 1));
  const { lint } = codeQuality(await runResult.json('result.json'));
  const total = (key) => directResults.reduce((count, result) => count + result[key], 0);
  assert.deepEqual(lint.facts, {
    checkedFiles: directResults.length,
    parseErrors: total('fatalErrorCount'),
    errors: total('errorCount'),
    warnings: total('warningCount'),
  });
  assert.deepEqual(lint.details.rules, [{ rule: 'no-console', count: 2 }, { rule: 'no-unused-vars', count: 1 }]);
});

test('ESLint 10 с .eslintrc выдаёт причину с подсказкой о миграции', async (t) => {
  const dir = await project(t, {
    '.eslintrc.json': '{}\n',
    'src/index.js': 'export const value = 1;\n',
  });
  await useEslint10(dir);
  const runResult = run(dir);
  assert.equal(runResult.status, 2, runResult.stderr);
  const lint = (await runResult.json('no-data.json')).find(({ plugin }) => plugin === 'lint');
  assert.equal(lint.code, 'eslint-legacy-config-unsupported');
  assert.match(lint.action, /eslint\.config/);
});

test('ESLint 10 проверяет требования к Node.js до загрузки движка', async (t) => {
  const dir = await project(t, {
    'eslint.config.mjs': 'export default [];\n',
    'simulate-node-version.cjs': "Object.defineProperty(process, 'version', { value: 'v22.12.0' });\n",
  });
  await useEslint10(dir);
  const runResult = run(dir, {
    ...process.env,
    NODE_OPTIONS: '--require=./simulate-node-version.cjs',
  });
  assert.equal(runResult.status, 2, runResult.stderr);
  const lint = (await runResult.json('no-data.json')).find(({ plugin }) => plugin === 'lint');
  assert.equal(lint.code, 'eslint-node-unsupported');
  assert.match(lint.reason, /22\.12\.0/);
  assert.match(lint.reason, /22\.13\.0/);
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
