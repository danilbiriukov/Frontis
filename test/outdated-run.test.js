import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');

async function registry(t, packages) {
  const requests = [];
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
    requests.push(name);
    const latest = packages[name];
    response.setHeader('content-type', 'application/json');
    if (typeof latest !== 'string') {
      response.writeHead(latest ?? 404);
      response.end(JSON.stringify({ error: 'Пакет недоступен' }));
      return;
    }
    const versions = Object.fromEntries(['1.0.0', latest].map((version) => [version, { name, version }]));
    response.end(JSON.stringify({ name, 'dist-tags': { latest }, versions }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { url: `http://127.0.0.1:${server.address().port}/`, requests };
}

async function project(t, registryUrl, { dependencies = {}, devDependencies = {}, build = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'frontis-outdated-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const modules = Object.fromEntries(
    ['knip', 'lint', 'prettier', 'coverage', 'node-version', 'build-size'].map((name) => [name, { enabled: false }])
  );
  modules['build-size'].enabled = build;
  const manifest = { name: 'demo-outdated', packageManager: 'npm@11', dependencies, devDependencies };
  const files = {
    'package.json': JSON.stringify(manifest),
    'frontis.config.mjs': `export default ${JSON.stringify({ modules })};\n`,
    '.npmrc': `registry=${registryUrl}\n`,
    ...(build ? { 'dist/index.js': 'export {};\n' } : {}),
  };
  for (const name of Object.keys({ ...dependencies, ...devDependencies })) {
    files[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: '1.0.0' });
  }
  for (const [file, content] of Object.entries(files)) {
    const path = join(dir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return dir;
}

function run(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ![
    'npm_config_registry', 'npm_config_userconfig', 'npm_config_offline',
  ].includes(key.toLowerCase())));
  env.npm_config_userconfig = join(dir, 'empty-user-npmrc');
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, 'run'], { cwd: dir, env, timeout: 35_000 }, (error, stdout, stderr) => {
      const json = async (file) => JSON.parse(await readFile(join(dir, '.frontis', file), 'utf8'));
      resolve({ code: error === null ? 0 : error.code, stdout, stderr, json });
    });
  });
}

function outdatedIndicator(result) {
  return result.indicators.find(({ id }) => id === 'outdated');
}

test('npm сохраняет официальные аудиты и считает долю для каждой группы', async (t) => {
  const { url, requests } = await registry(t, { 'lib-major': '2.0.0', 'lib-current': '1.0.0', 'dev-patch': '1.0.1' });
  const dir = await project(t, url, {
    dependencies: { 'lib-major': '^1.0.0', 'lib-current': '^1.0.0', 'lib-local': 'file:./local' },
    devDependencies: { 'dev-patch': '1.0.0' },
  });
  const output = await run(dir);
  assert.equal(output.code, 0, `${output.stdout}\n${output.stderr}`);
  const report = reportSchema.parse(await output.json('report.json'));
  const packages = report.plugins.find(({ slug }) => slug === 'js-packages');
  assert.equal(packages.packageName, '@code-pushup/js-packages-plugin');
  assert.equal(packages.version, '0.126.4');
  assert.deepEqual(packages.audits.filter(({ slug }) => slug.startsWith('npm-outdated-')).map(({ slug, value }) => [slug, value]), [
    ['npm-outdated-prod', 1], ['npm-outdated-dev', 1],
  ]);
  const { status, checks: [check] } = outdatedIndicator(await output.json('result.json'));
  assert.equal(status, 'fix');
  assert.equal(check.facts.productionComparable, 2);
  assert.equal(check.facts.productionOutdatedPercent, 50);
  assert.equal(check.facts.developmentComparable, 1);
  assert.equal(check.facts.developmentOutdatedPercent, 100);
  assert.deepEqual(check.details.issues.map(({ package: name, level, currentVersion, targetVersion }) =>
    [name, level, currentVersion, targetVersion]
  ), [
    ['lib-major', 'major', '1.0.0', '2.0.0'], ['dev-patch', 'patch', '1.0.0', '1.0.1'],
  ]);
  assert(requests.includes('lib-current'));
  assert(!requests.includes('lib-local'));
});

test('подтверждённый ноль учитывается, а пустая группа не даёт долю', async (t) => {
  const { url } = await registry(t, { 'lib-current': '1.0.0' });
  const dir = await project(t, url, { dependencies: { 'lib-current': '1.0.0' } });
  const output = await run(dir);
  assert.equal(output.code, 0, output.stderr);
  const { status, checks: [check] } = outdatedIndicator(await output.json('result.json'));
  assert.equal(status, 'ok');
  assert.equal(check.facts.production, 0);
  assert.equal(check.facts.productionOutdatedPercent, 0);
  assert.equal(check.facts.developmentState, 'empty');
  assert.equal(check.facts.developmentOutdatedPercent, undefined);
});

test('подтверждённая группа сохраняется при недоступности пакета из другой группы', async (t) => {
  const { url } = await registry(t, { 'lib-current': '1.0.0', 'dev-missing': 404 });
  const dir = await project(t, url, {
    dependencies: { 'lib-current': '1.0.0' }, devDependencies: { 'dev-missing': '1.0.0' },
  });
  const output = await run(dir);
  assert.equal(output.code, 0, output.stderr);
  const { status, incomplete, checks: [check] } = outdatedIndicator(await output.json('result.json'));
  assert.equal(status, 'ok');
  assert.equal(incomplete, true);
  assert.equal(check.code, 'registry-unconfirmed');
  assert.equal(check.facts.productionOutdatedPercent, 0);
  assert.equal(check.facts.development, undefined);
  assert.equal(check.facts.developmentOutdatedPercent, undefined);
});

test('недоступный реестр не превращается в ноль и не мешает другим проверкам', async (t) => {
  const { url } = await registry(t, { 'lib-unavailable': 503 });
  const dir = await project(t, url, { dependencies: { 'lib-unavailable': '1.0.0' }, build: true });
  const output = await run(dir);
  assert.equal(output.code, 0, output.stderr);
  const report = reportSchema.parse(await output.json('report.json'));
  assert.deepEqual(report.plugins.map(({ slug }) => slug), ['frontis-build-size']);
  const { status, code, checks: [check] } = outdatedIndicator(await output.json('result.json'));
  assert.equal(status, 'no-data');
  assert.equal(code, 'registry-unavailable');
  assert.equal(check.facts.production, undefined);
});
