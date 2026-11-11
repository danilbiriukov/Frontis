import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { reportSchema } from '@code-pushup/models';

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');

async function registry(t, packages, { advisories = {}, auditStatus = 200 } = {}) {
  const requests = [];
  const auditRequests = [];
  const server = createServer(async (request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const body = request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
      const payload = JSON.parse(body.toString('utf8'));
      auditRequests.push(payload);
      const selected = Object.fromEntries(Object.entries(advisories).filter(([dependency]) => Object.hasOwn(payload, dependency)));
      response.writeHead(auditStatus);
      response.end(JSON.stringify(auditStatus === 200 ? selected : { error: 'Аудит недоступен' }));
      return;
    }
    requests.push(name);
    const latest = Object.hasOwn(packages, name) ? packages[name] : undefined;
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
  return { url: `http://127.0.0.1:${server.address().port}/`, requests, auditRequests };
}

async function project(t, registryUrl, {
  dependencies = {}, devDependencies = {}, build = false, audit = false, outdated = true, lock = audit, offline = false,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'frontis-outdated-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const modules = Object.fromEntries(
    ['knip', 'lint', 'prettier', 'coverage', 'node-version', 'build-size'].map((name) => [name, { enabled: false }])
  );
  modules['build-size'].enabled = build;
  modules.audit = { enabled: audit };
  modules.outdated = { enabled: outdated };
  const manifest = { name: 'demo-outdated', packageManager: 'npm@11', dependencies, devDependencies };
  const files = {
    'package.json': JSON.stringify(manifest),
    'frontis.config.mjs': `export default ${JSON.stringify({ modules })};\n`,
    '.npmrc': `registry=${registryUrl}\nfetch-retries=0\noffline=${offline}\n`,
    ...(build ? { 'dist/index.js': 'export {};\n' } : {}),
  };
  for (const name of Object.keys({ ...dependencies, ...devDependencies })) {
    files[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: '1.0.0' });
  }
  if (lock) {
    const packages = { '': manifest };
    for (const name of Object.keys({ ...dependencies, ...devDependencies })) {
      packages[`node_modules/${name}`] = {
        version: '1.0.0',
        resolved: `${registryUrl}${name}/-/${name}-1.0.0.tgz`,
        ...(!Object.hasOwn(dependencies, name) ? { dev: true } : {}),
      };
    }
    files['package-lock.json'] = JSON.stringify({ name: manifest.name, lockfileVersion: 3, requires: true, packages });
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
    execFile(process.execPath, [cli, 'run'], { cwd: dir, env, timeout: 60_000 }, (error, stdout, stderr) => {
      const json = async (file) => JSON.parse(await readFile(join(dir, '.frontis', file), 'utf8'));
      resolve({ code: error === null ? 0 : error.code, stdout, stderr, json });
    });
  });
}

function outdatedIndicator(result) {
  return result.indicators.find(({ id }) => id === 'outdated');
}

function auditIndicator(result) {
  return result.indicators.find(({ id }) => id === 'audit');
}

function advisory(id, severity, vulnerableVersions) {
  return [{
    id, severity,
    title: 'Контрольная уязвимость',
    url: `https://example.invalid/advisories/${id}`,
    vulnerable_versions: vulnerableVersions,
    cwe: ['CWE-79'],
    cvss: { score: 0, vectorString: null },
  }];
}

test('npm сохраняет официальные аудиты и считает долю для каждой группы', async (t) => {
  const { url, requests } = await registry(t, { 'lib-major': '2.0.0', 'lib-current': '1.0.0', 'dev-patch': '1.0.1' });
  const dir = await project(t, url, {
    dependencies: { 'lib-major': '^1.0.0', 'lib-current': '^1.0.0', 'lib-local': 'file:./local' },
    devDependencies: { 'dev-patch': '1.0.0' },
  });
  await writeFile(join(dir, 'entry.js'), "import 'lib-major/subpath';\nimport 'dev-patch';\n");
  const output = await run(dir);
  assert.equal(output.code, 0, `${output.stdout}\n${output.stderr}`);
  const report = reportSchema.parse(await output.json('report.json'));
  const packages = report.plugins.find(({ slug }) => slug === 'js-packages');
  assert.equal(packages.packageName, '@code-pushup/js-packages-plugin');
  assert.equal(packages.version, '0.126.4');
  assert.deepEqual(packages.audits.filter(({ slug }) => slug.startsWith('npm-outdated-')).map(({ slug, value }) => [slug, value]), [
    ['npm-outdated-prod', 1], ['npm-outdated-dev', 1],
  ]);
  const result = await output.json('result.json');
  const { status, checks: [check] } = outdatedIndicator(result);
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
  assert.equal(result.importMap.status, 'ok');
  assert.deepEqual(result.importMap.packages.map(({ name, imports }) => [name, imports]), [
    ['lib-major', [{ file: 'entry.js', line: 1, specifier: 'lib-major/subpath' }]],
    ['dev-patch', [{ file: 'entry.js', line: 2, specifier: 'dev-patch' }]],
  ]);
  assert.match(await readFile(join(dir, '.frontis/report.html'), 'utf8'), /<code>lib-major\/subpath<\/code>/);
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

test('js-packages объединяет устаревшие пакеты и уязвимости npm в одном отчёте', async (t) => {
  const { url, auditRequests } = await registry(t, { 'lib-critical': '2.0.0', 'dev-moderate': '1.0.0' }, {
    advisories: {
      'lib-critical': advisory(100001, 'critical', '<2.0.0'),
      'dev-moderate': advisory(100002, 'moderate', '*'),
    },
  });
  const dir = await project(t, url, {
    dependencies: { 'lib-critical': '^1.0.0' }, devDependencies: { 'dev-moderate': '1.0.0' }, audit: true,
  });
  const output = await run(dir);
  assert.equal(output.code, 0, `${output.stdout}\n${output.stderr}`);
  const report = reportSchema.parse(await output.json('report.json'));
  assert.deepEqual(report.plugins.map(({ slug }) => slug), ['js-packages']);
  const packages = report.plugins[0];
  const bySlug = Object.fromEntries(packages.audits.map((audit) => [audit.slug, audit]));
  assert.equal(bySlug['npm-outdated-prod'].value, 1);
  assert.equal(bySlug['npm-audit-prod'].value, 1);
  assert.equal(bySlug['npm-audit-dev'].value, 1);
  assert.equal(bySlug['npm-audit-prod'].details.issues[0].severity, 'error');
  assert.equal(bySlug['npm-audit-dev'].details.issues[0].severity, 'warning');
  assert.deepEqual(packages.groups.map(({ slug }) => slug), ['npm-outdated', 'npm-audit']);
  const { status, checks: [check], findings } = auditIndicator(await output.json('result.json'));
  assert.equal(status, 'fix');
  assert.equal(check.facts.critical, 1);
  assert.equal(check.facts.moderate, 1);
  assert.deepEqual(findings.map(({ importance }) => importance), ['high', 'mid']);
  const [production, development] = check.details.issues;
  assert.equal(production.package, 'lib-critical');
  assert.equal(production.level, 'critical');
  assert.equal(production.group, 'prod');
  assert.deepEqual(production.fix, { available: true, package: 'lib-critical', version: '2.0.0', breaking: true });
  assert.equal(development.package, 'dev-moderate');
  assert.equal(development.group, 'dev');
  assert.deepEqual(development.fix, { available: false });
  assert(auditRequests.some((request) => Object.hasOwn(request, 'lib-critical') && !Object.hasOwn(request, 'dev-moderate')));
  assert(auditRequests.some((request) => Object.hasOwn(request, 'dev-moderate')));
});

test('успешный npm audit подтверждает ноль, автономный режим даёт «Нет данных»', async (t) => {
  const { url, auditRequests } = await registry(t, {});
  const dir = await project(t, url, {
    dependencies: { 'lib-clean': '1.0.0' }, audit: true, outdated: false,
  });
  const clean = await run(dir);
  assert.equal(clean.code, 0, clean.stderr);
  const { status, checks: [check] } = auditIndicator(await clean.json('result.json'));
  assert.equal(status, 'ok');
  assert.equal(check.facts.production, 0);
  assert.equal(check.facts.development, 0);
  assert(auditRequests.length > 0);

  const onlineRequests = auditRequests.length;
  await writeFile(join(dir, '.npmrc'), `registry=${url}\noffline=true\n`);
  const offline = await run(dir);
  assert.equal(offline.code, 2, offline.stderr);
  const noData = (await offline.json('no-data.json')).find(({ plugin }) => plugin === 'audit');
  assert.equal(noData.code, 'registry-unavailable');
  assert.equal(auditRequests.length, onlineRequests);
  await assert.rejects(offline.json('report.json'), { code: 'ENOENT' });
});

test('сбой npm audit сохраняет результаты устаревших пакетов', async (t) => {
  const { url } = await registry(t, { 'lib-major': '2.0.0' }, { auditStatus: 503 });
  const dir = await project(t, url, { dependencies: { 'lib-major': '1.0.0' }, audit: true });
  const output = await run(dir);
  assert.equal(output.code, 0, output.stderr);
  const report = reportSchema.parse(await output.json('report.json'));
  assert.deepEqual(report.plugins.map(({ slug }) => slug), ['js-packages']);
  assert(report.plugins[0].audits.every(({ slug }) => !slug.startsWith('npm-audit-')));
  const result = await output.json('result.json');
  const audit = auditIndicator(result);
  assert.equal(audit.status, 'no-data');
  assert.equal(audit.code, 'registry-unavailable');
  assert.equal(audit.checks[0].facts.production, undefined);
  assert.equal(outdatedIndicator(result).status, 'fix');
});

test('отсутствие lock-файла даёт отдельную причину для npm audit', async (t) => {
  const { url, auditRequests } = await registry(t, {});
  const dir = await project(t, url, { dependencies: { 'lib-clean': '1.0.0' }, audit: true, outdated: false, lock: false });
  const output = await run(dir);
  assert.equal(output.code, 2, output.stderr);
  const noData = (await output.json('no-data.json')).find(({ plugin }) => plugin === 'audit');
  assert.equal(noData.code, 'no-npm-lockfile');
  assert.equal(auditRequests.length, 0);
});
