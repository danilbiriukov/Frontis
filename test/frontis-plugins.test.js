import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { collect } from '@code-pushup/core';
import { pluginConfigSchema, reportSchema } from '@code-pushup/models';
import {
  CollectorRunError,
  createBuildSizePlugin,
  createKnipPlugin,
  createNodeVersionPlugin,
  createPrettierPlugin,
} from '../dist/index.js';

const root = join(import.meta.dirname, '..');
const knipFixture = (name) => join(import.meta.dirname, 'fixtures', 'knip', name);
const gitPath = (file) => relative(root, file).split(sep).join('/');

async function project(t, files) {
  const cache = join(root, '.cache');
  await mkdir(cache, { recursive: true });
  const projectDir = await mkdtemp(join(cache, 'frontis-plugins-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    const path = join(projectDir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return projectDir;
}

test('фабрики работают в обычной конфигурации Code PushUp', async (t) => {
  const dir = await project(t, {
    'package.json': '{\n  "name": "demo"\n}\n',
    '.prettierrc': '{}\n',
    'broken.js': 'export const = ;\n',
    'dist/index.js': 'export {};\n',
    '.nvmrc': '22.0.0\n',
  });
  const plugins = [
    createKnipPlugin(knipFixture('findings')),
    createPrettierPlugin(dir),
    createNodeVersionPlugin(dir, {
      fetch: async () => Response.json([
        { version: 'v24.1.0', lts: 'Test LTS' },
        { version: 'v22.0.0', lts: false },
      ]),
    }),
    createBuildSizePlugin(dir, { maxMb: 1 }),
  ].map((plugin) => pluginConfigSchema.parse(plugin));
  const { plugins: reports } = reportSchema.parse(await collect({ cache: {}, plugins }));
  const [knip, prettier, node, build] = reports;
  assert.deepEqual(reports.map(({ slug }) => slug), [
    'frontis-knip', 'frontis-prettier', 'frontis-node-version', 'frontis-build-size',
  ]);
  assert.deepEqual(knip.audits.map(({ slug, value }) => [slug, value]), [
    ['unused-files', 1], ['unused-dependencies', 1], ['unused-exports', 1], ['unused-types', 1], ['other-findings', 0],
  ]);
  assert.deepEqual(knip.audits.find(({ slug }) => slug === 'unused-exports').details.issues[0].source, {
    file: gitPath(join(knipFixture('findings'), 'src', 'lib.ts')),
    position: { startLine: 3, startColumn: 14 },
  });
  assert.deepEqual(prettier.audits.find(({ slug }) => slug === 'parse-errors').details.issues[0].source, {
    file: gitPath(join(dir, 'broken.js')),
    position: { startLine: 1, startColumn: 14 },
  });
  assert.equal(node.audits.find(({ slug }) => slug === 'latest-lts').displayValue, '24.1.0');
  assert.equal(node.audits.find(({ slug }) => slug === 'version-lag').value, 3);
  assert.equal(build.audits.find(({ slug }) => slug === 'limit-bytes').value, 1024 ** 2);
  assert.deepEqual(build.audits.find(({ slug }) => slug === 'size-bytes').details.table.rows, [
    { file: 'dist/index.js', bytes: 11 },
  ]);
});

test('чистый knip возвращает нулевые аудиты, ошибка конфигурации сохраняет причину', async () => {
  const { plugins: [report] } = await collect({ cache: {}, plugins: [createKnipPlugin(knipFixture('clean'))] });
  assert(report.audits.every(({ value, score }) => value === 0 && score === 1));
  await assert.rejects(
    collect({ cache: {}, plugins: [createKnipPlugin(knipFixture('broken'))] }),
    (error) => error instanceof CollectorRunError && error.result.code === 'knip-failed',
  );
});

test('frontis run собирает аудиты knip и Prettier с настройками проекта', async (t) => {
  const dir = await project(t, {
    'package.json': '{\n  "name": "demo",\n  "type": "module"\n}\n',
    'frontis.config.mjs': "export default { modules: { 'node-version': { enabled: false }, 'build-size': { enabled: false } } };\n",
    '.prettierrc': '{}\n',
    'src/index.js': 'console.log("demo");\n',
  });
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), 'run'], {
    cwd: dir, encoding: 'utf8',
  });
  assert.equal(status, 0, `${stdout}\n${stderr}`);
  assert.match(stdout, /Аудиты Frontis: 8\. Модули без данных: 6/);
  const noData = JSON.parse(await readFile(join(dir, '.frontis', 'no-data.json'), 'utf8'));
  assert.deepEqual(noData.map(({ plugin, code }) => [plugin, code]), [
    ['outdated', 'no-package-manager'], ['audit', 'no-package-manager'],
    ['lint', 'no-eslint-config'], ['coverage', 'no-lcov'],
    ['node-version', 'disabled'], ['build-size', 'disabled'],
  ]);
});
