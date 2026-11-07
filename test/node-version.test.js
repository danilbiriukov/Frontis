import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNodeVersionCollector, NODE_RELEASES_URL, parseReleases } from '../dist/index.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-07T00:00:00Z');

const index = [
  { version: 'v27.0.0-alpha.0', lts: false },
  { version: 'v26.13.0', lts: false },
  { version: 'v24.11.1', lts: 'Krypton' },
  { version: 'v24.11.0', lts: 'Krypton' },
  { version: 'v24.10.0', lts: false },
  { version: 'v22.21.1', lts: 'Jod' },
  { version: 'v22.12.0', lts: 'Jod' },
  { version: 'v20.19.5', lts: 'Iron' },
];

function fakeFetch(calls, body = index) {
  return async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

const offline = async () => {
  throw new TypeError('fetch failed');
};

async function project(t, files) {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-node-version-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) await writeFile(join(projectDir, file), content);
  return projectDir;
}

async function run(t, files, options = {}) {
  const projectDir = await project(t, files);
  const calls = [];
  const collect = createNodeVersionCollector({ fetch: fakeFetch(calls), now: () => NOW, ...options });
  return { result: await collect({ projectDir }), calls, projectDir };
}

test('порядок источников: .nvmrc, затем .node-version, затем engines.node', async (t) => {
  const engines = JSON.stringify({ engines: { node: '>=20' } });
  const all = await run(t, { '.nvmrc': '22.12.0\n', '.node-version': '20.19.5', 'package.json': engines });
  assert.deepEqual(all.result.data.source, { file: '.nvmrc', value: '22.12.0' });

  const noNvmrc = await run(t, { '.node-version': 'v20.19.5\n', 'package.json': engines });
  assert.deepEqual(noNvmrc.result.data.source, { file: '.node-version', value: 'v20.19.5' });

  const onlyEngines = await run(t, { 'package.json': engines });
  assert.deepEqual(onlyEngines.result.data.source, { file: 'package.json', value: '>=20' });

  const emptyNvmrc = await run(t, { '.nvmrc': '# комментарий\n\n', 'package.json': engines });
  assert.equal(emptyNvmrc.result.data.source.file, 'package.json');
});

test('точная версия: отставание major, minor и patch', async (t) => {
  for (const [value, lag, severity] of [['20.19.5', 'major', 'error'], ['24.10.0', 'minor', 'warning'], ['v24.11.0', 'patch', 'info']]) {
    const { result } = await run(t, { '.nvmrc': value });
    assert.equal(result.data.kind, 'exact');
    assert.equal(result.data.lag, lag, value);
    assert.deepEqual(result.data.latestLts, { version: '24.11.1', codename: 'Krypton' });
    assert.deepEqual(result.findings.map(({ code, severity, source }) => [code, severity, source]), [[`node-${lag}-behind`, severity, { file: '.nvmrc' }]]);
  }
  const { result } = await run(t, { '.nvmrc': '24.11.1' });
  assert.equal(result.data.lag, null);
  assert.equal(result.data.allowsLatestLts, true);
  assert.deepEqual(result.findings, []);
});

test('диапазоны и неполные версии сравниваются по новейшему подходящему релизу', async (t) => {
  const cases = [
    ['>=20', '26.13.0', true, null],
    ['^22', '22.21.1', false, 'major'],
    ['22', '22.21.1', false, 'major'],
    ['20.x || 22.x', '22.21.1', false, 'major'],
    ['^24.10.0', '24.11.1', true, null],
  ];
  for (const [range, version, allowsLatestLts, lag] of cases) {
    const { result } = await run(t, { 'package.json': JSON.stringify({ engines: { node: range } }) });
    assert.equal(result.data.kind, 'range', range);
    assert.equal(result.data.version, version, range);
    assert.equal(result.data.allowsLatestLts, allowsLatestLts, range);
    assert.equal(result.data.lag, lag, range);
  }
});

test('алиасы nvm разрешаются по списку релизов', async (t) => {
  const cases = [['lts/*', '24.11.1', null], ['lts/iron', '20.19.5', 'major'], ['lts/Jod', '22.21.1', 'major'], ['node', '26.13.0', null]];
  for (const [alias, version, lag] of cases) {
    const { result } = await run(t, { '.nvmrc': alias });
    assert.equal(result.data.kind, 'alias', alias);
    assert.equal(result.data.version, version, alias);
    assert.equal(result.data.lag, lag, alias);
  }
});

test('ответ сохраняется на сутки и используется без сети', async (t) => {
  const projectDir = await project(t, { '.nvmrc': '22.12.0' });
  const calls = [];
  const first = await createNodeVersionCollector({ fetch: fakeFetch(calls), now: () => NOW })({ projectDir });
  assert.equal(first.data.releases, 'network');
  assert.deepEqual(calls, [NODE_RELEASES_URL]);
  const cache = JSON.parse(await readFile(join(projectDir, '.frontis', 'cache', 'node-releases.json'), 'utf8'));
  assert.equal(cache.fetchedAt, NOW);

  const cached = await createNodeVersionCollector({ fetch: offline, now: () => NOW + DAY - 1 })({ projectDir });
  assert.equal(cached.data.releases, 'cache');
  assert.equal(cached.data.lag, 'major');

  const refreshed = await createNodeVersionCollector({ fetch: fakeFetch(calls), now: () => NOW + DAY })({ projectDir });
  assert.equal(refreshed.data.releases, 'network');
  assert.equal(calls.length, 2);

  const stale = await createNodeVersionCollector({ fetch: offline, now: () => NOW + 3 * DAY })({ projectDir });
  assert.equal(stale.data.releases, 'stale-cache');
});

test('ошибка записи кэша не отменяет ответ сайта', async (t) => {
  const projectDir = await project(t, { '.nvmrc': '22.12.0', blocker: '' });
  const calls = [];
  const result = await createNodeVersionCollector({ fetch: fakeFetch(calls), now: () => NOW, cacheFile: join(projectDir, 'blocker', 'cache.json') })({ projectDir });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.releases, 'network');
});

test('без сети и кэша возвращается «Нет данных»', async (t) => {
  const { result } = await run(t, { '.nvmrc': '22.12.0' }, { fetch: offline });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'node-releases-unavailable');
  assert.ok(result.cause instanceof TypeError);
});

test('ответ сайта в неожиданном формате не принимается', async (t) => {
  const calls = [];
  const { result } = await run(t, { '.nvmrc': '22.12.0' }, { fetch: fakeFetch(calls, { error: 'nope' }) });
  assert.equal(result.code, 'node-releases-unavailable');
  assert.equal(parseReleases([{ version: 1 }]), undefined);
  assert.equal(parseReleases([]), undefined);
});

test('без версии Node.js или с неразбираемой версией возвращается «Нет данных»', async (t) => {
  const none = await run(t, { 'package.json': '{"name":"demo"}' });
  assert.equal(none.result.code, 'no-node-version');
  assert.deepEqual(none.calls, []);

  for (const value of ['banana', '^99']) {
    const { result } = await run(t, { '.nvmrc': value });
    assert.equal(result.status, 'no-data', value);
    assert.equal(result.code, 'invalid-node-version', value);
  }
});
